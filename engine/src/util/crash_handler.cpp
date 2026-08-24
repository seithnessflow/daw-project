// SPDX-License-Identifier: GPL-3.0-or-later
#include "crash_handler.h"

#include <atomic>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <exception>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

namespace daw::util {
namespace {

std::atomic<bool> g_handling{false};

void writeCrashLog(const char* reason, void* exception_ptrs) {
    // One shot: a crashing crash handler must not recurse
    if (g_handling.exchange(true)) return;

    char path[512];
#ifdef _WIN32
    // Next to the exe, NOT the CWD - engines launched via WMI or
    // scheduled tasks inherit unpredictable working directories
    char dir[MAX_PATH] = "";
    DWORD len = GetModuleFileNameA(nullptr, dir, sizeof(dir));
    while (len > 0 && dir[len - 1] != '\\' && dir[len - 1] != '/') --len;
    dir[len] = '\0';
    std::snprintf(path, sizeof(path), "%scrash-%lu.log", dir,
                  static_cast<unsigned long>(GetCurrentProcessId()));
#else
    std::snprintf(path, sizeof(path), "crash.log");
#endif
    std::FILE* f = std::fopen(path, "w");
    if (!f) return;
    std::fprintf(f, "REASON: %s\n", reason);

#ifdef _WIN32
    if (exception_ptrs) {
        auto* xp = static_cast<EXCEPTION_POINTERS*>(exception_ptrs);
        std::fprintf(f, "EXCEPTION CODE: 0x%08lx at %p\n",
                     xp->ExceptionRecord->ExceptionCode,
                     xp->ExceptionRecord->ExceptionAddress);
    }
    // Raw stack: module+offset per frame - mappable without PDBs
    void* frames[62];
    const USHORT n = CaptureStackBackTrace(0, 62, frames, nullptr);
    for (USHORT i = 0; i < n; ++i) {
        HMODULE mod = nullptr;
        char name[MAX_PATH] = "?";
        if (GetModuleHandleExA(
                GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                static_cast<const char*>(frames[i]), &mod) && mod) {
            GetModuleFileNameA(mod, name, sizeof(name));
        }
        std::fprintf(f, "#%02u %p %s+0x%llx\n", i, frames[i], name,
                     static_cast<unsigned long long>(
                         reinterpret_cast<uintptr_t>(frames[i]) -
                         reinterpret_cast<uintptr_t>(mod)));
    }
#endif
    std::fflush(f);
    std::fclose(f);
}

#ifdef _WIN32
LONG WINAPI sehFilter(EXCEPTION_POINTERS* xp) {
    writeCrashLog("unhandled SEH exception", xp);
    return EXCEPTION_CONTINUE_SEARCH;  // let WER report too
}
#endif

void onTerminate() {
    writeCrashLog("std::terminate (uncaught C++ exception?)", nullptr);
    std::abort();
}

void onAbort(int) {
    writeCrashLog("SIGABRT (abort/assert/CRT fail-fast family)", nullptr);
}

#ifdef _WIN32
void onInvalidParameter(const wchar_t*, const wchar_t*, const wchar_t*,
                        unsigned int, uintptr_t) {
    writeCrashLog("CRT invalid parameter", nullptr);
    std::abort();
}
#endif

}  // namespace

void installCrashHandler() {
    std::set_terminate(onTerminate);
    std::signal(SIGABRT, onAbort);
#ifdef _WIN32
    SetUnhandledExceptionFilter(sehFilter);
    _set_invalid_parameter_handler(onInvalidParameter);
    // abort() must run our SIGABRT hook, not the silent fast-exit
    _set_abort_behavior(0, _WRITE_ABORT_MSG | _CALL_REPORTFAULT);
#endif
}

}  // namespace daw::util
