// SPDX-License-Identifier: GPL-3.0-or-later
#include "plugin_scan.h"

#include "host_messages.pb.h"

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <cstdio>
#endif

namespace daw::host {

namespace fs = std::filesystem;

namespace {

// Signature d'invalidation : taille (0 pour un bundle-dossier) + mtime.
struct Sig {
    uint64_t size = 0;
    int64_t mtime = 0;
};

Sig signatureOf(const fs::path& p) {
    Sig s;
    std::error_code ec;
    if (fs::is_regular_file(p, ec)) {
        s.size = static_cast<uint64_t>(fs::file_size(p, ec));
    }
    const auto t = fs::last_write_time(p, ec);
    s.mtime = static_cast<int64_t>(t.time_since_epoch().count());
    return s;
}

struct CacheRow {
    Sig sig;
    bool failed = false;
    std::vector<ScannedPlugin> entries;  // module_path rempli au chargement
};

// TSV : path \t size \t mtime \t status \t uid \t name \t vendor \t sub
// (une ligne par classe ; status=fail -> ligne unique sans classe)
std::map<std::string, CacheRow> loadCache(const std::string& cache_path) {
    std::map<std::string, CacheRow> out;
    std::ifstream f(cache_path);
    std::string line;
    while (std::getline(f, line)) {
        std::stringstream ss(line);
        std::string path, size_s, mtime_s, status, uid, name, vendor, sub;
        if (!std::getline(ss, path, '\t') || !std::getline(ss, size_s, '\t') ||
            !std::getline(ss, mtime_s, '\t') || !std::getline(ss, status, '\t')) {
            continue;
        }
        std::getline(ss, uid, '\t');
        std::getline(ss, name, '\t');
        std::getline(ss, vendor, '\t');
        std::getline(ss, sub, '\t');
        auto& row = out[path];
        try {
            row.sig.size = std::stoull(size_s);
            row.sig.mtime = std::stoll(mtime_s);
        } catch (...) { continue; }
        if (status == "fail") {
            row.failed = true;
        } else if (!uid.empty()) {
            row.entries.push_back({uid, name, vendor, sub, path});
        }
    }
    return out;
}

void saveCache(const std::string& cache_path,
               const std::map<std::string, CacheRow>& cache) {
    std::ofstream f(cache_path, std::ios::trunc);
    for (const auto& [path, row] : cache) {
        if (row.failed) {
            f << path << '\t' << row.sig.size << '\t' << row.sig.mtime
              << "\tfail\n";
            continue;
        }
        for (const auto& e : row.entries) {
            f << path << '\t' << row.sig.size << '\t' << row.sig.mtime
              << "\tok\t" << e.uid << '\t' << e.name << '\t' << e.vendor
              << '\t' << e.sub_categories << '\n';
        }
    }
}

// Enumeration par l'ENFANT : stdout capture (HostResponse protobuf,
// prefixe longueur 4 octets big-endian), timeout borne, echec propre.
bool enumerateWithChild(const std::string& host_exe, const std::string& module,
                        std::vector<ScannedPlugin>& out, std::ostream& log) {
    std::string payload;
#ifdef _WIN32
    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE read_h = nullptr, write_h = nullptr;
    if (!CreatePipe(&read_h, &write_h, &sa, 0)) return false;
    SetHandleInformation(read_h, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOA si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = write_h;
    si.hStdError = nullptr;   // le bavardage stderr n'interesse pas le scan
    si.hStdInput = nullptr;
    PROCESS_INFORMATION pi{};
    std::string cmd = "\"" + host_exe + "\" --enumerate \"" + module + "\"";
    std::vector<char> mutable_cmd(cmd.begin(), cmd.end());
    mutable_cmd.push_back('\0');
    const BOOL ok = CreateProcessA(nullptr, mutable_cmd.data(), nullptr, nullptr,
                                   TRUE, CREATE_NO_WINDOW, nullptr, nullptr,
                                   &si, &pi);
    CloseHandle(write_h);
    if (!ok) {
        CloseHandle(read_h);
        return false;
    }
    // Lire jusqu'a EOF ; le timeout est gere par la mort du process
    char buf[4096];
    DWORD n = 0;
    while (ReadFile(read_h, buf, sizeof(buf), &n, nullptr) && n > 0) {
        payload.append(buf, buf + n);
        if (payload.size() > (1u << 20)) break;  // 1 Mo = jamais legitime
    }
    CloseHandle(read_h);
    const DWORD wait = WaitForSingleObject(pi.hProcess, 15000);
    if (wait != WAIT_OBJECT_0) {
        TerminateProcess(pi.hProcess, 1);
        log << "scan: TIMEOUT sur " << module << "\n";
    }
    DWORD code = 1;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    if (wait != WAIT_OBJECT_0 || code != 0) return false;
#else
    // Controle-plan uniquement : popen suffit (POSIX = CI)
    const std::string cmd = "\"" + host_exe + "\" --enumerate \"" + module +
                            "\" 2>/dev/null";
    FILE* p = popen(cmd.c_str(), "r");
    if (!p) return false;
    char buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), p)) > 0) {
        payload.append(buf, buf + n);
        if (payload.size() > (1u << 20)) break;
    }
    if (pclose(p) != 0) return false;
#endif

    if (payload.size() < 4) return false;
    const auto* u = reinterpret_cast<const unsigned char*>(payload.data());
    const uint32_t len = (uint32_t(u[0]) << 24) | (uint32_t(u[1]) << 16) |
                         (uint32_t(u[2]) << 8) | uint32_t(u[3]);
    if (payload.size() < 4 + len) return false;
    daw::host::HostResponse resp;
    if (!resp.ParseFromArray(payload.data() + 4, static_cast<int>(len))) {
        return false;
    }
    if (!resp.has_enumerate() || !resp.enumerate().ok()) return false;
    for (const auto& c : resp.enumerate().classes()) {
        if (c.category() != "Audio Module Class") continue;
        out.push_back({c.class_id(), c.name(), c.vendor(),
                       c.sub_categories(), module});
    }
    return true;
}

}  // namespace

std::vector<ScannedPlugin> scanVst3Dir(const std::string& dir,
                                       const std::string& host_exe,
                                       const std::string& cache_path,
                                       std::ostream& log) {
    std::vector<ScannedPlugin> result;
    std::error_code ec;
    if (!fs::is_directory(dir, ec)) {
        log << "scan: dossier absent: " << dir << "\n";
        return result;
    }
    auto cache = loadCache(cache_path);
    size_t fresh = 0, cached = 0, failed = 0;
    for (const auto& entry : fs::directory_iterator(dir, ec)) {
        const fs::path& p = entry.path();
        if (p.extension() != ".vst3") continue;
        const std::string key = p.string();
        const Sig sig = signatureOf(p);
        auto it = cache.find(key);
        if (it != cache.end() && it->second.sig.size == sig.size &&
            it->second.sig.mtime == sig.mtime) {
            if (it->second.failed) { ++failed; continue; }
            for (auto e : it->second.entries) {
                e.module_path = key;
                result.push_back(std::move(e));
            }
            ++cached;
            continue;
        }
        // Nouveau ou modifie : enumeration par l'enfant
        std::vector<ScannedPlugin> found;
        CacheRow row;
        row.sig = sig;
        if (enumerateWithChild(host_exe, key, found, log)) {
            row.entries = found;
            for (auto& e : found) result.push_back(e);
            ++fresh;
        } else {
            row.failed = true;
            ++failed;
            log << "scan: echec (memorise): " << key << "\n";
        }
        cache[key] = std::move(row);
    }
    saveCache(cache_path, cache);
    log << "scan: " << dir << " -> " << result.size() << " classe(s) ("
        << cached << " en cache, " << fresh << " enumere(s), " << failed
        << " en echec)\n";
    return result;
}

}  // namespace daw::host
