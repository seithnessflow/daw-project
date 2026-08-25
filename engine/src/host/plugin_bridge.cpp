// SPDX-License-Identifier: GPL-3.0-or-later
#include "plugin_bridge.h"
#include "state_file.h"

#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <thread>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <unistd.h>
#include <csignal>
#endif

namespace daw::host {

namespace fs = std::filesystem;

PluginBridge::~PluginBridge() {
    stop();
}

bool PluginBridge::createSegment() {
    // Unique file-backed mapping: portable across Windows/POSIX and easy to
    // hand to the child by path
    segment_path_ = (fs::temp_directory_path() /
                     ("daw-ring-" + std::to_string(
#ifdef _WIN32
                          static_cast<long long>(GetCurrentProcessId())
#else
                          static_cast<long long>(getpid())
#endif
                          ) + "-" + std::to_string(reinterpret_cast<uintptr_t>(this)) + ".shm"))
                        .string();

    {
        std::ofstream f(segment_path_, std::ios::binary | std::ios::trunc);
        const std::vector<char> zeros(sizeof(SharedAudioRing), 0);
        f.write(zeros.data(), static_cast<std::streamsize>(zeros.size()));
        if (!f.good()) {
            error_ = "cannot create segment file: " + segment_path_;
            return false;
        }
    }

#ifdef _WIN32
    HANDLE file = CreateFileA(segment_path_.c_str(), GENERIC_READ | GENERIC_WRITE,
                              FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        error_ = "CreateFile failed on segment";
        return false;
    }
    HANDLE mapping = CreateFileMappingA(file, nullptr, PAGE_READWRITE, 0,
                                        sizeof(SharedAudioRing), nullptr);
    if (!mapping) {
        CloseHandle(file);
        error_ = "CreateFileMapping failed";
        return false;
    }
    void* view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(SharedAudioRing));
    if (!view) {
        CloseHandle(mapping);
        CloseHandle(file);
        error_ = "MapViewOfFile failed";
        return false;
    }
    file_handle_ = file;
    map_handle_ = mapping;
    ring_ = static_cast<SharedAudioRing*>(view);
#else
    int fd = open(segment_path_.c_str(), O_RDWR);
    if (fd < 0) {
        error_ = "open failed on segment";
        return false;
    }
    void* view = mmap(nullptr, sizeof(SharedAudioRing), PROT_READ | PROT_WRITE,
                      MAP_SHARED, fd, 0);
    if (view == MAP_FAILED) {
        close(fd);
        error_ = "mmap failed";
        return false;
    }
    file_handle_ = reinterpret_cast<void*>(static_cast<intptr_t>(fd));
    ring_ = static_cast<SharedAudioRing*>(view);
#endif

    std::memset(static_cast<void*>(ring_), 0, sizeof(SharedAudioRing));
    ring_->magic = kRingMagic;
    ring_->layout_version = kLayoutVersion;
    ring_->block_size = kRingBlockSize;
    // v9 : etat desire de la fenetre GUI. Avec --editors l'enfant ouvre au
    // spawn -> l'etat desire doit demarrer a 1, sinon la boucle serve
    // refermerait aussitot. Sinon 0 : ouverture seulement sur message kEditor.
    ring_->editor_open.store(spawn_editors_ ? 1u : 0u, std::memory_order_release);
    return true;
}

bool PluginBridge::spawnChild(const std::string& host_exe,
                              const std::string& module_path,
                              const std::string& class_uid) {
    // --parent: the child watches THIS process and exits when it dies (a
    // hard-killed engine cannot raise the shutdown flag; without this, the
    // orphan spins forever - observed, it held plugin_host.exe locked)
    const long long self_pid =
#ifdef _WIN32
        static_cast<long long>(GetCurrentProcessId());
#else
        static_cast<long long>(getpid());
#endif
    const std::string parent_arg = std::to_string(self_pid);  // pre-fork: no malloc in the child
    const std::string cmdline = "\"" + host_exe + "\" --serve \"" + segment_path_ +
                                "\" --module \"" + module_path + "\" --uid " + class_uid +
                                " --parent " + parent_arg +
                                (spawn_editors_ ? " --editor" : "");
#ifdef _WIN32
    STARTUPINFOA si{};
    si.cb = sizeof(si);
    // Les DERNIERS MOTS de l'enfant (organe sensoriel 2026-08-24) : sans
    // heritage de poignees, son stderr partait dans le vide - un enfant
    // mort en setup ne disait jamais pourquoi. <segment>.log les garde.
    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE log = CreateFileA((segment_path_ + ".log").c_str(), GENERIC_WRITE,
                             FILE_SHARE_READ, &sa, CREATE_ALWAYS,
                             FILE_ATTRIBUTE_NORMAL, nullptr);
    BOOL inherit = FALSE;
    if (log != INVALID_HANDLE_VALUE) {
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdError = log;
        si.hStdOutput = log;
        si.hStdInput = nullptr;
        inherit = TRUE;
    }
    PROCESS_INFORMATION pi{};
    std::vector<char> mutable_cmd(cmdline.begin(), cmdline.end());
    mutable_cmd.push_back('\0');
    const BOOL created = CreateProcessA(nullptr, mutable_cmd.data(), nullptr,
                                        nullptr, inherit, CREATE_NO_WINDOW,
                                        nullptr, nullptr, &si, &pi);
    if (log != INVALID_HANDLE_VALUE) CloseHandle(log);
    if (!created) {
        error_ = "CreateProcess failed for plugin_host";
        return false;
    }
    CloseHandle(pi.hThread);
    process_handle_ = pi.hProcess;
    child_pid_ = pi.dwProcessId;
#else
    const pid_t pid = fork();
    if (pid < 0) {
        error_ = "fork failed";
        return false;
    }
    if (pid == 0) {
        execl(host_exe.c_str(), host_exe.c_str(), "--serve", segment_path_.c_str(),
              "--module", module_path.c_str(), "--uid", class_uid.c_str(),
              "--parent", parent_arg.c_str(),
              static_cast<char*>(nullptr));
        _exit(127);
    }
    child_pid_ = pid;
#endif
    return true;
}

bool PluginBridge::start(const std::string& host_exe, const std::string& module_path,
                         const std::string& class_uid, uint32_t sample_rate,
                         uint32_t timeout_ms) {
    if (ring_) {
        error_ = "bridge already running";
        return false;
    }
    if (!createSegment()) return false;
    ring_->sample_rate = sample_rate;

    // Kept for cold restarts (restartChild)
    host_exe_ = host_exe;
    module_path_ = module_path;
    class_uid_ = class_uid;

    // 2.5-etat: a staged blob is on disk BEFORE the child spawns - its
    // ceremony restores it, processor-first, before ready
    if (!pending_state_.empty()) {
        if (!writeStateFile(statePath(), pending_state_)) {
            error_ = "cannot write pending state file";
            unmapSegment();
            return false;
        }
    }

    if (!spawnChild(host_exe, module_path, class_uid)) {
        unmapSegment();
        return false;
    }
    if (!waitChildReady(timeout_ms)) {
        stop();
        return false;
    }
    return true;
}

// Ready = the child finished the full VST3 ceremony (heartbeat != 0).
// A child that died instead is detected by the process handle.
bool PluginBridge::waitChildReady(uint32_t timeout_ms) {
    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(timeout_ms);
    while (std::chrono::steady_clock::now() < deadline) {
        if (ring_->child_heartbeat.load(std::memory_order_acquire) != 0) {
            return true;
        }
        if (!childAlive()) {
            error_ = "plugin_host exited during setup (see its stderr)";
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    error_ = "plugin_host did not become ready within timeout";
    return false;
}

void PluginBridge::reapChildHandle() {
#ifdef _WIN32
    if (process_handle_) {
        CloseHandle(static_cast<HANDLE>(process_handle_));
        process_handle_ = nullptr;
    }
    child_pid_ = 0;
#else
    if (child_pid_ > 0) {
        int status = 0;
        waitpid(static_cast<pid_t>(child_pid_), &status, WNOHANG);
    }
    child_pid_ = 0;
#endif
}

bool PluginBridge::restartChild(uint32_t timeout_ms) {
    if (!ring_) {
        error_ = "bridge not running";
        return false;
    }
    reapChildHandle();
    // The old life's beats must not fake readiness; nobody else writes
    // here once the child is dead
    ring_->child_heartbeat.store(0, std::memory_order_release);
    // 2.5-etat: refresh the staged blob for the new life
    if (!pending_state_.empty()) {
        if (!writeStateFile(statePath(), pending_state_)) {
            error_ = "cannot write pending state file";
            return false;
        }
    }
    // v5: the FIFO was consumed by the old life - replay the latest
    // value of every param BEFORE the spawn (the queue lives in the
    // shared ring and waits for the child), so even the new life's
    // FIRST block - backlog included - hears what the old one did.
    // The old single slot survived restarts by accident; this is the
    // deliberate version, without the dry window.
    for (const auto& [id, value] : last_params_) {
        setParam(id, value);
    }
    if (!spawnChild(host_exe_, module_path_, class_uid_)) {
        return false;
    }
    if (!waitChildReady(timeout_ms)) {
        return false;
    }
    ++restart_count_;
    return true;
}

void PluginBridge::terminateChildForTest() {
#ifdef _WIN32
    if (process_handle_) {
        TerminateProcess(static_cast<HANDLE>(process_handle_), 9);
        WaitForSingleObject(static_cast<HANDLE>(process_handle_), 2000);
    }
#else
    if (child_pid_ > 0) {
        kill(static_cast<pid_t>(child_pid_), SIGKILL);
        int status = 0;
        waitpid(static_cast<pid_t>(child_pid_), &status, 0);
        child_pid_ = -child_pid_;  // reaped, dead
    }
#endif
}

bool PluginBridge::childAlive() {
#ifdef _WIN32
    if (!process_handle_) return false;
    return WaitForSingleObject(static_cast<HANDLE>(process_handle_), 0) == WAIT_TIMEOUT;
#else
    if (child_pid_ <= 0) return false;
    int status = 0;
    const pid_t r = waitpid(static_cast<pid_t>(child_pid_), &status, WNOHANG);
    if (r == static_cast<pid_t>(child_pid_)) {
        child_pid_ = -child_pid_;  // reaped
        return false;
    }
    return r == 0;
#endif
}

bool PluginBridge::saveState(std::vector<uint8_t>& out, uint32_t timeout_ms) {
    if (!ring_) {
        error_ = "bridge not running";
        return false;
    }
    // One request = one bump; the child copies the request into ready
    // once the file is written (or removed, on plugin refusal)
    const uint64_t req =
        ring_->state_request_seq.fetch_add(1, std::memory_order_acq_rel) + 1;
    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(timeout_ms);
    while (ring_->state_ready_seq.load(std::memory_order_acquire) < req) {
        if (std::chrono::steady_clock::now() >= deadline) {
            error_ = "state save timed out (child busy or dead)";
            return false;
        }
        if (!childAlive()) {
            error_ = "child died during state save";
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    if (!readStateFile(statePath(), out)) {
        error_ = "plugin refused getState (no state file)";
        return false;
    }
    return true;
}

void PluginBridge::setParam(uint32_t param_id, double normalized) {
    if (!ring_) return;
    last_params_[param_id] = normalized;  // restart replay cache (v5)
    // v5 FIFO write (single writer, see shared_audio_ring.h). Full =
    // overwrite the OLDEST (advance read_idx): a >64 burst degrades to
    // latest-wins, the control thread never stalls.
    const uint64_t w = ring_->param_write_idx.load(std::memory_order_relaxed);
    uint64_t r = ring_->param_read_idx.load(std::memory_order_acquire);
    if (w - r >= kParamQueueSlots) {
        ring_->param_read_idx.compare_exchange_strong(
            r, r + 1, std::memory_order_acq_rel);
    }
    const uint32_t slot = static_cast<uint32_t>(w % kParamQueueSlots);
    ring_->param_ids[slot] = param_id;
    ring_->param_values[slot] = normalized;
    ring_->param_write_idx.store(w + 1, std::memory_order_release);
}

void PluginBridge::sendMidiNote(bool note_on, uint8_t pitch, uint8_t velocity,
                                uint8_t channel, uint32_t sample_offset) {
    if (!ring_) return;
    // Le FIFO SPSC vit dans le ring : un seul ecrivain a la fois (ici le
    // thread de controle, offline ; le ProxyNode en live). Voir pushMidiEvent.
    pushMidiEvent(ring_, note_on, pitch, velocity, channel, sample_offset);
}

bool PluginBridge::processBlockSync(const float* in_l, const float* in_r,
                                    float* out_l, float* out_r,
                                    uint32_t n, uint32_t timeout_ms) {
    if (!ring_ || n == 0 || n > kRingBlockSize) {
        error_ = "bad bridge state or block size";
        return false;
    }

    const uint64_t seq = ++next_seq_;
    const uint32_t slot = static_cast<uint32_t>(seq % kRingSlots);
    std::memcpy(ring_->in[slot][0], in_l, n * sizeof(float));
    std::memcpy(ring_->in[slot][1], in_r, n * sizeof(float));
    if (n < kRingBlockSize) {
        std::memset(ring_->in[slot][0] + n, 0, (kRingBlockSize - n) * sizeof(float));
        std::memset(ring_->in[slot][1] + n, 0, (kRingBlockSize - n) * sizeof(float));
    }
    ring_->input_seq.store(seq, std::memory_order_release);

    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(timeout_ms);
    while (ring_->output_seq.load(std::memory_order_acquire) < seq) {
        if (std::chrono::steady_clock::now() >= deadline) {
            error_ = "child did not produce block " + std::to_string(seq) +
                     (childAlive() ? " (alive, too slow)" : " (child DEAD)");
            return false;
        }
        std::this_thread::yield();
    }

    std::memcpy(out_l, ring_->out[slot][0], n * sizeof(float));
    std::memcpy(out_r, ring_->out[slot][1], n * sizeof(float));
    return true;
}

void PluginBridge::stop() {
    if (ring_) {
        ring_->shutdown.store(1, std::memory_order_release);
    }
#ifdef _WIN32
    if (process_handle_) {
        if (WaitForSingleObject(static_cast<HANDLE>(process_handle_), 2000) == WAIT_TIMEOUT) {
            TerminateProcess(static_cast<HANDLE>(process_handle_), 1);
            WaitForSingleObject(static_cast<HANDLE>(process_handle_), 2000);
        }
        CloseHandle(static_cast<HANDLE>(process_handle_));
        process_handle_ = nullptr;
    }
#else
    if (child_pid_ > 0) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        int status = 0;
        while (std::chrono::steady_clock::now() < deadline &&
               waitpid(static_cast<pid_t>(child_pid_), &status, WNOHANG) == 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        if (waitpid(static_cast<pid_t>(child_pid_), &status, WNOHANG) == 0) {
            kill(static_cast<pid_t>(child_pid_), SIGKILL);
            waitpid(static_cast<pid_t>(child_pid_), &status, 0);
        }
        child_pid_ = 0;
    }
#endif
    unmapSegment();
}

void PluginBridge::unmapSegment() {
    if (ring_) {
#ifdef _WIN32
        UnmapViewOfFile(ring_);
        if (map_handle_) CloseHandle(static_cast<HANDLE>(map_handle_));
        if (file_handle_) CloseHandle(static_cast<HANDLE>(file_handle_));
        map_handle_ = nullptr;
        file_handle_ = nullptr;
#else
        munmap(ring_, sizeof(SharedAudioRing));
        close(static_cast<int>(reinterpret_cast<intptr_t>(file_handle_)));
        file_handle_ = nullptr;
#endif
        ring_ = nullptr;
    }
    if (!segment_path_.empty()) {
        std::error_code ec;
        fs::remove(segment_path_ + ".state", ec);  // 2.5-etat side-channel
        fs::remove(segment_path_, ec);
        segment_path_.clear();
    }
    next_seq_ = 0;
}

}  // namespace daw::host
