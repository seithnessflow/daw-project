// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file plugin_host_main.cpp
 * @brief VST3 plugin host - child process (ADR-017).
 *
 * 2.4a scope: `plugin_host --enumerate <path.vst3>` loads the module,
 * enumerates the factory classes and writes ONE length-prefixed
 * daw.host.HostResponse to stdout (binary), then exits. Human-readable
 * diagnostics go to stderr. A bad or corrupt module must produce a clean
 * error and a non-zero exit code - never a crash of the host: crashing on
 * hostile modules is precisely what this child process exists to absorb
 * instead of the engine.
 *
 * VST3::Hosting::Module encapsulates the platform ritual (bundle folder
 * vs legacy DLL, InitDll() before GetPluginFactory(), ExitDll() on
 * destruction).
 */

#include "host_messages.pb.h"
#include "shared_audio_ring.h"
#include "state_file.h"

#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/eventlist.h"

#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"

#include <bitset>
#include <cmath>
#include <map>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <avrt.h>  // MMCSS : AvSetMmThreadCharacteristics (lib avrt)
#pragma comment(lib, "avrt.lib")
#else
#include <cerrno>
#include <csignal>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#endif

namespace {

// Same framing as the browser protocol: 4-byte big-endian length prefix
bool writeResponse(const daw::host::HostResponse& resp) {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::string payload;
    if (!resp.SerializeToString(&payload)) {
        return false;
    }
    const uint32_t len = static_cast<uint32_t>(payload.size());
    const unsigned char prefix[4] = {
        static_cast<unsigned char>((len >> 24) & 0xFF),
        static_cast<unsigned char>((len >> 16) & 0xFF),
        static_cast<unsigned char>((len >> 8) & 0xFF),
        static_cast<unsigned char>(len & 0xFF),
    };
    if (std::fwrite(prefix, 1, 4, stdout) != 4) return false;
    if (len > 0 && std::fwrite(payload.data(), 1, len, stdout) != len) return false;
    std::fflush(stdout);
    return true;
}

// Windows error strings arrive in the ANSI codepage (e.g. CP1252 accents):
// invalid UTF-8, which protobuf refuses to serialize. Keep ASCII, replace
// the rest - the message stays legible, the protocol stays valid.
std::string toProtoSafe(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (const unsigned char c : s) {
        out.push_back((c < 0x80) ? static_cast<char>(c) : '?');
    }
    return out;
}

int fail(daw::host::HostResponse& resp, const std::string& error) {
    auto* enu = resp.mutable_enumerate();
    enu->set_ok(false);
    enu->set_error(toProtoSafe(error));
    std::cerr << "plugin_host error: " << error << std::endl;
    writeResponse(resp);
    return 1;
}

// ---- Minimal 16-bit stereo WAV I/O -----------------------------------------
// Symmetric 1/32768 scale on both directions: float(s)=s/32768,
// int16(f)=f*32768 (clamped). Every 16-bit value is exact in float, so a
// gain of 1.0 is a bit-exact identity and 0.5 (a power of two) is exact too.

bool readWav16Stereo(const std::string& path, std::vector<int16_t>& samples, uint32_t& sample_rate) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::vector<char> buf((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    if (buf.size() < 12 || std::memcmp(buf.data(), "RIFF", 4) != 0) return false;

    uint16_t channels = 0, bits = 0;
    size_t off = 12;
    while (off + 8 <= buf.size()) {
        const std::string id(buf.data() + off, 4);
        uint32_t size;
        std::memcpy(&size, buf.data() + off + 4, 4);
        // Audit M3: the chunk body must fit in the buffer BEFORE any field
        // read or allocation - a lying size header was an OOB read and a
        // pre-check 2 GB alloc. Compute in size_t (no 32-bit wrap).
        const size_t body_end = off + 8 + static_cast<size_t>(size);
        if (body_end > buf.size()) return false;
        if (id == "fmt " && size >= 16) {
            std::memcpy(&channels, buf.data() + off + 10, 2);
            std::memcpy(&sample_rate, buf.data() + off + 12, 4);
            std::memcpy(&bits, buf.data() + off + 22, 2);
        } else if (id == "data") {
            if (channels != 2 || bits != 16) return false;
            const size_t count = size / 2;               // body already bounded
            samples.resize(count);
            std::memcpy(samples.data(), buf.data() + off + 8, count * 2);
            return true;
        }
        off += 8 + static_cast<size_t>(size) + (size % 2);
    }
    return false;
}

bool writeWav16Stereo(const std::string& path, const std::vector<int16_t>& samples, uint32_t sample_rate) {
    std::ofstream f(path, std::ios::binary);
    if (!f) return false;
    const uint32_t data_size = static_cast<uint32_t>(samples.size() * 2);
    const uint32_t chunk = 36 + data_size, fmt = 16, byte_rate = sample_rate * 4;
    const uint16_t pcm = 1, ch = 2, align = 4, bits = 16;
    f.write("RIFF", 4); f.write(reinterpret_cast<const char*>(&chunk), 4);
    f.write("WAVE", 4); f.write("fmt ", 4);
    f.write(reinterpret_cast<const char*>(&fmt), 4);
    f.write(reinterpret_cast<const char*>(&pcm), 2);
    f.write(reinterpret_cast<const char*>(&ch), 2);
    f.write(reinterpret_cast<const char*>(&sample_rate), 4);
    f.write(reinterpret_cast<const char*>(&byte_rate), 4);
    f.write(reinterpret_cast<const char*>(&align), 2);
    f.write(reinterpret_cast<const char*>(&bits), 2);
    f.write("data", 4); f.write(reinterpret_cast<const char*>(&data_size), 4);
    f.write(reinterpret_cast<const char*>(samples.data()), data_size);
    return f.good();
}

// ---- Process mode (2.4b) ---------------------------------------------------
// The full VST3 instantiation ceremony, in order; EVERY refusal is a clean
// error in the ProcessResult, never a crash. Fixed 256-sample blocks: the
// engine's INTERNAL_BLOCK_SIZE becomes a formal contract with third-party
// code here. Parameters go through IParameterChanges - the same channel the
// document's chain will drive in 2.4c.

constexpr int32_t kHostBlockSize = 256;
static_assert(daw::host::kRingBlockSize == static_cast<uint32_t>(kHostBlockSize),
              "ring block size and host block size are the same contract");

// ---- State side-channel (2.5-etat) -----------------------------------------
// A minimal in-memory IBStream: the SDK's MemoryStream is only compiled by
// the validator sample, and pulling it in would evict the CI's SDK build
// cache - 50 self-contained lines beat that.
class BlobStream final : public Steinberg::IBStream {
public:
    explicit BlobStream(std::vector<uint8_t> data = {}) : data_(std::move(data)) {}
    std::vector<uint8_t>& data() { return data_; }

    // FUnknown - stack-owned, never heap-refcounted
    Steinberg::tresult PLUGIN_API queryInterface(const Steinberg::TUID iid,
                                                 void** obj) override {
        if (Steinberg::FUnknownPrivate::iidEqual(iid, Steinberg::IBStream::iid) ||
            Steinberg::FUnknownPrivate::iidEqual(iid, Steinberg::FUnknown::iid)) {
            *obj = this;
            return Steinberg::kResultOk;
        }
        *obj = nullptr;
        return Steinberg::kNoInterface;
    }
    Steinberg::uint32 PLUGIN_API addRef() override { return 2; }
    Steinberg::uint32 PLUGIN_API release() override { return 1; }

    Steinberg::tresult PLUGIN_API read(void* buffer, Steinberg::int32 num_bytes,
                                       Steinberg::int32* bytes_read) override {
        const auto avail = static_cast<Steinberg::int64>(data_.size()) - pos_;
        const auto n = std::max<Steinberg::int64>(
            0, std::min<Steinberg::int64>(num_bytes, avail));
        if (n > 0) std::memcpy(buffer, data_.data() + pos_, static_cast<size_t>(n));
        pos_ += n;
        if (bytes_read) *bytes_read = static_cast<Steinberg::int32>(n);
        return Steinberg::kResultOk;
    }
    Steinberg::tresult PLUGIN_API write(void* buffer, Steinberg::int32 num_bytes,
                                        Steinberg::int32* bytes_written) override {
        if (num_bytes < 0) return Steinberg::kInvalidArgument;
        const auto end = pos_ + num_bytes;
        if (static_cast<size_t>(end) > data_.size()) data_.resize(static_cast<size_t>(end));
        std::memcpy(data_.data() + pos_, buffer, static_cast<size_t>(num_bytes));
        pos_ = end;
        if (bytes_written) *bytes_written = num_bytes;
        return Steinberg::kResultOk;
    }
    Steinberg::tresult PLUGIN_API seek(Steinberg::int64 pos, Steinberg::int32 mode,
                                       Steinberg::int64* result) override {
        Steinberg::int64 base = 0;
        if (mode == kIBSeekCur) base = pos_;
        else if (mode == kIBSeekEnd) base = static_cast<Steinberg::int64>(data_.size());
        const auto target = base + pos;
        if (target < 0) return Steinberg::kInvalidArgument;
        pos_ = target;
        if (result) *result = pos_;
        return Steinberg::kResultOk;
    }
    Steinberg::tresult PLUGIN_API tell(Steinberg::int64* pos) override {
        if (pos) *pos = pos_;
        return Steinberg::kResultOk;
    }

private:
    std::vector<uint8_t> data_;
    Steinberg::int64 pos_ = 0;
};

// ---- Fenetrage v1 (verrue assumee, arbitrage utilisateur 2026-08-24) -------
// La GUI native du plugin dans une fenetre OS, pompee sur LE MEME thread
// que la boucle de service : zero concurrence. Une fenetre trainee = une
// boucle modale = quelques blocs servis en retard, que le moteur bypass
// et COMPTE deja (degradation prevue par le ring, jamais un blocage).
// Les tweaks GUI (performEdit) partent dans les IParameterChanges du bloc
// suivant : audibles immediatement. HONNETE : ils ne sont PAS persistes
// au document (la capture d'etat 2.5 ne les voit qu'au prochain rebuild).

// performEdit atterrit ici (meme thread que la pompe) ; coalesce par id -
// un drag de potard = des centaines d'edits, seul le dernier par bloc
// compte pour l'audio.
class GuiParamSink final : public Steinberg::Vst::IComponentHandler {
public:
    std::map<Steinberg::Vst::ParamID, double> pending;

    Steinberg::tresult PLUGIN_API queryInterface(const Steinberg::TUID iid,
                                                 void** obj) override {
        if (Steinberg::FUnknownPrivate::iidEqual(
                iid, Steinberg::Vst::IComponentHandler::iid) ||
            Steinberg::FUnknownPrivate::iidEqual(iid, Steinberg::FUnknown::iid)) {
            *obj = this;
            return Steinberg::kResultOk;
        }
        *obj = nullptr;
        return Steinberg::kNoInterface;
    }
    Steinberg::uint32 PLUGIN_API addRef() override { return 2; }
    Steinberg::uint32 PLUGIN_API release() override { return 1; }

    Steinberg::tresult PLUGIN_API beginEdit(Steinberg::Vst::ParamID) override {
        return Steinberg::kResultOk;
    }
    Steinberg::tresult PLUGIN_API performEdit(Steinberg::Vst::ParamID id,
                                              Steinberg::Vst::ParamValue v) override {
        pending[id] = v;
        return Steinberg::kResultOk;
    }
    Steinberg::tresult PLUGIN_API endEdit(Steinberg::Vst::ParamID) override {
        return Steinberg::kResultOk;
    }
    Steinberg::tresult PLUGIN_API restartComponent(Steinberg::int32) override {
        return Steinberg::kResultOk;  // v1: param flush suffit au cas courant
    }
};

// ---- Le controleur d'edition, acquis UNE fois par instance (v11) ----------
// Avant v11 la fenetre creait son propre controleur a l'ouverture ; le
// mapping MIDI (IMidiMapping) en a besoin des la ceremonie, sans fenetre.
// Un seul controleur par instance : la fenetre le REUTILISE (deux
// controleurs = deux vues de l'etat, les edits GUI iraient au second).
// Classe dediee si le composant en declare une, sinon le composant
// lui-meme (effets mono-classe). Echec = headless (pas de map, pas de
// fenetre), jamais un echec de l'instance.
struct EditController {
    Steinberg::IPtr<Steinberg::Vst::IEditController> controller;
    bool is_component = false;

    bool acquire(VST3::Hosting::Module::Ptr& module,
                 Steinberg::IPtr<Steinberg::Vst::IComponent>& component,
                 Steinberg::Vst::HostApplication& host_app) {
        using namespace Steinberg;
        Steinberg::TUID ctrl_tuid{};
        if (component->getControllerClassId(ctrl_tuid) == kResultOk) {
            controller = module->getFactory()
                             .createInstance<Vst::IEditController>(
                                 VST3::UID::fromTUID(ctrl_tuid));
            if (controller && controller->initialize(&host_app) != kResultOk) {
                controller = nullptr;
            }
        }
        if (!controller) {
            controller = FUnknownPtr<Vst::IEditController>(component);
            is_component = static_cast<bool>(controller);
        }
        if (!controller) return false;
        // Connexion composant <-> controleur (meme process : directe)
        {
            FUnknownPtr<Vst::IConnectionPoint> cp_comp(component);
            FUnknownPtr<Vst::IConnectionPoint> cp_ctrl(controller);
            if (cp_comp && cp_ctrl && !is_component) {
                cp_comp->connect(cp_ctrl);
                cp_ctrl->connect(cp_comp);
            }
        }
        // Synchroniser le controleur sur l'etat courant du processeur
        if (!is_component) {
            BlobStream s;
            if (component->getState(&s) == kResultOk) {
                s.seek(0, IBStream::kIBSeekSet, nullptr);
                controller->setComponentState(&s);
            }
        }
        return true;
    }

    void release() {
        if (controller) {
            controller->setComponentHandler(nullptr);
            if (!is_component) controller->terminate();
            controller = nullptr;
        }
    }
};

// ---- Table MIDI -> parametre (v11, IMidiMapping) ----------------------------
// VST3 n'a pas d'evenement CC : un controleur EST un parametre que le
// plugin DECLARE par canal (getMidiControllerAssignment). On interroge la
// table une fois a la ceremonie (canaux 0..15, CC 0..127 + pitch-bend) ;
// au drain, un CC/pitch-bend devient un point d'IParameterChanges a son
// offset. Non declare = ignore (compte, jamais un parametre devine).
struct MidiParamMap {
    static constexpr int kSlots = Steinberg::Vst::kCountCtrlNumber;  // 0..131
    Steinberg::Vst::ParamID ids[16][kSlots];
    bool any = false;

    MidiParamMap() {
        for (auto& row : ids)
            for (auto& id : row) id = Steinberg::Vst::kNoParamId;
    }

    void build(Steinberg::Vst::IEditController* controller) {
        using namespace Steinberg;
        if (!controller) return;
        FUnknownPtr<Vst::IMidiMapping> mm(controller);
        if (!mm) return;
        int mapped = 0;
        for (int16 ch = 0; ch < 16; ++ch) {
            for (int16 cc = 0; cc < kSlots; ++cc) {
                Vst::ParamID id = Vst::kNoParamId;
                if (mm->getMidiControllerAssignment(0, ch, cc, id) == kResultTrue &&
                    id != Vst::kNoParamId) {
                    ids[ch][cc] = id;
                    ++mapped;
                }
            }
        }
        any = mapped > 0;
        std::cerr << "plugin_host: midi-mapping " << mapped
                  << " controller assignment(s)"
                  << (any ? "" : " (plugin declares none - CC/pitch-bend dropped)")
                  << std::endl;
    }

    Steinberg::Vst::ParamID lookup(uint8_t channel, int cc) const {
        if (channel > 15 || cc < 0 || cc >= kSlots) return Steinberg::Vst::kNoParamId;
        return ids[channel][cc];
    }
};

#ifdef _WIN32
struct EditorWindow {
    HWND hwnd = nullptr;
    Steinberg::IPtr<Steinberg::IPlugView> view;
    Steinberg::IPtr<Steinberg::Vst::IEditController> controller;  // EMPRUNTE a l'instance (v11)
    GuiParamSink handler;
    // 2026-08-26 : pointeur vers ring->editor_open - la croix (X) y ecrit 0
    // pour que l'etat desire suive la realite (voir WM_CLOSE).
    std::atomic<uint32_t>* want_flag = nullptr;

    static LRESULT CALLBACK wndProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
        auto* self = reinterpret_cast<EditorWindow*>(
            GetWindowLongPtrA(h, GWLP_USERDATA));
        switch (msg) {
            case WM_CLOSE:
                ShowWindow(h, SW_HIDE);  // v1 : cacher, jamais detruire le plugin
                // 2026-08-26 : la croix (X) REDESCEND l'etat desire du ring -
                // sinon il reste a 1 et le prochain BOX « ouvrir » est un
                // non-evenement (transition 1->1) : bouton mort en apparence.
                if (self && self->want_flag) {
                    self->want_flag->store(0u, std::memory_order_release);
                }
                return 0;
            case WM_SIZE:
                if (self && self->view &&
                    self->view->canResize() == Steinberg::kResultTrue) {
                    Steinberg::ViewRect r{0, 0, LOWORD(lp), HIWORD(lp)};
                    self->view->onSize(&r);
                }
                return 0;
            default:
                return DefWindowProcA(h, msg, wp, lp);
        }
    }

    bool open(Steinberg::IPtr<Steinberg::Vst::IEditController>& shared_controller,
              const std::string& title) {
        using namespace Steinberg;
        // 1-3 (v11) : le controleur est celui de l'instance, deja
        //    initialise/connecte/synchronise a la ceremonie (EditController)
        controller = shared_controller;
        if (!controller) {
            std::cerr << "plugin_host: no edit controller - headless" << std::endl;
            return false;
        }
        controller->setComponentHandler(&handler);
        // 4. La vue
        view = owned(controller->createView(Vst::ViewType::kEditor));
        if (!view) {
            std::cerr << "plugin_host: plugin has no editor view" << std::endl;
            return false;
        }
        ViewRect vr{};
        view->getSize(&vr);
        WNDCLASSA wc{};
        wc.lpfnWndProc = wndProc;
        wc.hInstance = GetModuleHandleA(nullptr);
        wc.lpszClassName = "DawPluginEditor";
        wc.hCursor = LoadCursorA(nullptr, reinterpret_cast<LPCSTR>(IDC_ARROW));
        RegisterClassA(&wc);  // idempotent-ish : un echec re-register est benin
        RECT wr{0, 0, vr.getWidth(), vr.getHeight()};
        AdjustWindowRect(&wr, WS_OVERLAPPEDWINDOW, FALSE);
        hwnd = CreateWindowExA(0, "DawPluginEditor", title.c_str(),
                               WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                               wr.right - wr.left, wr.bottom - wr.top,
                               nullptr, nullptr, wc.hInstance, nullptr);
        if (!hwnd) {
            std::cerr << "plugin_host: CreateWindow failed" << std::endl;
            return false;
        }
        SetWindowLongPtrA(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
        if (view->attached(hwnd, kPlatformTypeHWND) != kResultOk) {
            std::cerr << "plugin_host: view attach refused" << std::endl;
            DestroyWindow(hwnd);
            hwnd = nullptr;
            return false;
        }
        // Taille NATIVE (le fullscreen essaye puis retire le meme jour -
        // arbitrage utilisateur : « c'est nul ») ; une vue redimensionnable
        // reste redimensionnable a la main (WM_SIZE -> onSize).
        ShowWindow(hwnd, SW_SHOW);
        UpdateWindow(hwnd);
        // 2026-08-26 : DEVANT, toujours. La fenetre nait TOPMOST et le reste
        // tant qu'elle est ouverte (modele Ableton : les fenetres de plugin
        // flottent au-dessus du DAW). L'aller-retour TOPMOST->NOTOPMOST
        // essaye d'abord ne garantissait PAS le dessus depuis un process
        // d'arriere-plan (retour utilisateur : « les fenetres doivent
        // s'ouvrir devant chrome »). Le focus reste au navigateur (NOACTIVATE
        // + SetForegroundWindow d'arriere-plan echoue en silence, tant pis) -
        // ce qui compte est de VOIR la fenetre. Choix v1 a revisiter si le
        // « devant tout, meme les autres apps » gene.
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        SetForegroundWindow(hwnd);
        std::cerr << "plugin_host: editor window open (" << title << ")" << std::endl;
        return true;
    }

    void pump() {
        if (!hwnd) return;
        MSG msg;
        while (PeekMessageA(&msg, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageA(&msg);
        }
    }

    void close() {
        if (view) {
            view->removed();
            view = nullptr;
        }
        if (hwnd) {
            DestroyWindow(hwnd);
            hwnd = nullptr;
        }
        if (controller) {
            // v11 : le controleur appartient a l'instance - on rend juste
            // la main (le handler GUI ne doit plus recevoir d'edits)
            controller->setComponentHandler(nullptr);
            controller = nullptr;
        }
    }
};
// L'ouverture d'editeur executee du code TIERS : un crash la-dedans ne
// doit tuer que la FENETRE, jamais le service audio (constate : le
// fixture AGain plat, prive de ses ressources VSTGUI, crashe dans
// createView). Garde SEH - la fonction hote n'a AUCUN objet a derouler.
static bool openEditorGuarded(EditorWindow& w,
                              Steinberg::IPtr<Steinberg::Vst::IEditController>& controller,
                              const std::string& title) {
    __try {
        return w.open(controller, title);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        std::fprintf(stderr,
                     "plugin_host: editor open CRASHED (0x%08lX) - headless\n",
                     GetExceptionCode());
        return false;
    }
}
#endif  // _WIN32

// ---- The VST3 instantiation ceremony, shared by --process and --serve ------
// Extracted (not duplicated) when --serve arrived: one ceremony, two callers.
// Every refusal is a clean error string, never a crash.
struct PluginInstance {
    VST3::Hosting::Module::Ptr module;
    Steinberg::IPtr<Steinberg::Vst::IComponent> component;
    Steinberg::FUnknownPtr<Steinberg::Vst::IAudioProcessor> processor;
    Steinberg::Vst::HostApplication host_app;
    bool active = false;
    Steinberg::int32 num_audio_in = 1;  // v8 : 0 pour un instrument
    // v11 : le controleur d'edition (optionnel - headless sinon) et la
    // table MIDI -> parametre qu'il declare. Acquis apres la ceremonie
    // (voir acquireController), partages avec la fenetre.
    EditController edit;
    MidiParamMap midi_map;

    void acquireController() {
        if (!component) return;
        if (!edit.acquire(module, component, host_app)) {
            std::cerr << "plugin_host: no edit controller - headless, no midi mapping"
                      << std::endl;
            return;
        }
        midi_map.build(edit.controller.get());
    }

    bool setup(const std::string& module_path, const std::string& uid_str,
               double sample_rate, std::string& error) {
        using namespace Steinberg;

        std::string err;
        module = VST3::Hosting::Module::create(module_path, err);
        if (!module) {
            error = err.empty() ? "failed to load module" : err;
            return false;
        }

        auto uid = VST3::UID::fromString(uid_str);
        if (!uid) {
            error = "invalid class uid: " + uid_str;
            return false;
        }

        component = module->getFactory().createInstance<Vst::IComponent>(*uid);
        if (!component) {
            error = "createInstance refused (uid not an instantiable audio component)";
            return false;
        }

        if (component->initialize(&host_app) != kResultOk) {
            error = "IComponent::initialize refused";
            component = nullptr;
            return false;
        }

        processor = FUnknownPtr<Vst::IAudioProcessor>(component);
        if (!processor) {
            error = "component exposes no IAudioProcessor";
            teardown();
            return false;
        }

        // v8 : arrangement ADAPTATIF. Un effet = stereo in + stereo out ;
        // un INSTRUMENT n'a PAS de bus d'entree audio (numIn == 0) et
        // refusait setBusArrangements(stereo/stereo). On arrange exactement
        // les bus que le plugin declare, tous en stereo.
        const int32 numIn = component->getBusCount(Vst::kAudio, Vst::kInput);
        const int32 numOut = component->getBusCount(Vst::kAudio, Vst::kOutput);
        Vst::SpeakerArrangement inArr[8], outArr[8];
        const int32 ni = numIn < 0 ? 0 : (numIn > 8 ? 8 : numIn);
        const int32 no = numOut < 0 ? 0 : (numOut > 8 ? 8 : numOut);
        for (int32 b = 0; b < ni; ++b) inArr[b] = Vst::SpeakerArr::kStereo;
        for (int32 b = 0; b < no; ++b) outArr[b] = Vst::SpeakerArr::kStereo;
        if (processor->setBusArrangements(inArr, ni, outArr, no) != kResultOk) {
            error = "setBusArrangements refused";
            teardown();
            return false;
        }
        num_audio_in = ni;  // le process s'adapte (instrument = 0 entree)

        Vst::ProcessSetup setup{};
        setup.processMode = Vst::kRealtime;
        setup.symbolicSampleSize = Vst::kSample32;
        setup.maxSamplesPerBlock = kHostBlockSize;
        setup.sampleRate = sample_rate;
        if (processor->setupProcessing(setup) != kResultOk) {
            error = "setupProcessing refused";
            teardown();
            return false;
        }

        if ((ni > 0 && component->activateBus(Vst::kAudio, Vst::kInput, 0, true) != kResultOk) ||
            (no > 0 && component->activateBus(Vst::kAudio, Vst::kOutput, 0, true) != kResultOk)) {
            error = "activateBus refused";
            teardown();
            return false;
        }

        if (component->setActive(true) != kResultOk) {
            error = "setActive refused";
            teardown();
            return false;
        }
        active = true;
        // PDC ecrivain (session 3) : la latence interne declaree par le
        // plugin - lisible sur stderr pour les sondes, publiee au ring
        // par --serve
        latency_samples = processor->getLatencySamples();
        std::cerr << "plugin latency: " << latency_samples << " samples"
                  << std::endl;
        return true;
    }

    Steinberg::uint32 latency_samples = 0;

    void teardown() {
        edit.release();  // v11 : avant le composant (il y est connecte)
        if (component) {
            if (active) {
                component->setActive(false);
                active = false;
            }
            component->terminate();
            component = nullptr;
        }
        processor = nullptr;
    }
};

int failProcess(daw::host::HostResponse& resp, const std::string& error) {
    auto* pr = resp.mutable_process();
    pr->set_ok(false);
    pr->set_error(toProtoSafe(error));
    std::cerr << "plugin_host error: " << error << std::endl;
    writeResponse(resp);
    return 1;
}

int runProcess(const std::string& module_path, const std::string& uid_str,
               bool has_param, uint32_t param_id, double param_value,
               const std::string& in_path, const std::string& out_path) {
    using namespace Steinberg;
    daw::host::HostResponse resp;

    std::vector<int16_t> in_samples;
    uint32_t sample_rate = 0;
    if (!readWav16Stereo(in_path, in_samples, sample_rate)) {
        return failProcess(resp, "cannot read 16-bit stereo WAV: " + in_path);
    }

    PluginInstance inst;
    std::string err;
    if (!inst.setup(module_path, uid_str, static_cast<double>(sample_rate), err)) {
        return failProcess(resp, err);
    }
    auto& processor = inst.processor;

    std::vector<float> in_l(kHostBlockSize), in_r(kHostBlockSize);
    std::vector<float> out_l(kHostBlockSize), out_r(kHostBlockSize);
    float* in_ch[2] = {in_l.data(), in_r.data()};
    float* out_ch[2] = {out_l.data(), out_r.data()};

    Vst::AudioBusBuffers in_bus{};
    in_bus.numChannels = 2;
    in_bus.channelBuffers32 = in_ch;
    Vst::AudioBusBuffers out_bus{};
    out_bus.numChannels = 2;
    out_bus.channelBuffers32 = out_ch;

    const size_t total_frames = in_samples.size() / 2;
    std::vector<int16_t> out_samples(total_frames * 2);
    uint32_t blocks = 0;
    size_t frame = 0;
    bool param_sent = false;

    while (frame < total_frames) {
        const int32_t n = static_cast<int32_t>(
            std::min<size_t>(kHostBlockSize, total_frames - frame));

        for (int32_t i = 0; i < n; ++i) {
            in_l[i] = static_cast<float>(in_samples[(frame + i) * 2]) / 32768.0f;
            in_r[i] = static_cast<float>(in_samples[(frame + i) * 2 + 1]) / 32768.0f;
            out_l[i] = 0.0f;
            out_r[i] = 0.0f;
        }

        Vst::ParameterChanges param_changes;
        param_changes.setMaxParameters(1);
        if (has_param && !param_sent) {
            int32 queue_index = 0;
            auto* queue = param_changes.addParameterData(param_id, queue_index);
            if (queue) {
                int32 point_index = 0;
                queue->addPoint(0, param_value, point_index);
            }
            param_sent = true;
        }

        Vst::ProcessData data{};
        data.processMode = Vst::kRealtime;
        data.symbolicSampleSize = Vst::kSample32;
        data.numSamples = n;
        data.numInputs = 1;
        data.numOutputs = 1;
        data.inputs = &in_bus;
        data.outputs = &out_bus;
        data.inputParameterChanges = &param_changes;

        if (processor->process(data) != kResultOk) {
            inst.teardown();
            return failProcess(resp, "process refused at block " + std::to_string(blocks));
        }

        for (int32_t i = 0; i < n; ++i) {
            const float l = std::clamp(out_l[i] * 32768.0f, -32768.0f, 32767.0f);
            const float r = std::clamp(out_r[i] * 32768.0f, -32768.0f, 32767.0f);
            out_samples[(frame + i) * 2] = static_cast<int16_t>(l);
            out_samples[(frame + i) * 2 + 1] = static_cast<int16_t>(r);
        }

        frame += n;
        ++blocks;
    }

    inst.teardown();

    if (!writeWav16Stereo(out_path, out_samples, sample_rate)) {
        return failProcess(resp, "cannot write output WAV: " + out_path);
    }

    auto* pr = resp.mutable_process();
    pr->set_ok(true);
    pr->set_frames_processed(total_frames);
    pr->set_blocks(blocks);
    std::cerr << "processed " << total_frames << " frames in " << blocks << " blocks" << std::endl;
    return writeResponse(resp) ? 0 : 1;
}

// ---- Serve mode (2.4c-1) ---------------------------------------------------
// Persistent child on the shared segment (ADR-017): map the ring the engine
// created, run the ceremony, publish heartbeat=1 as the ready signal the
// bridge waits for, then serve blocks until the shutdown flag. The child
// always jumps to the NEWEST input_seq: a block it missed was already
// bypassed (and counted) engine-side - processing stale audio would only
// add latency to the living.

daw::host::SharedAudioRing* mapSegment(const std::string& path) {
    // Handles are deliberately not tracked: the mapping lives exactly as
    // long as this process, the OS reclaims both together.
#ifdef _WIN32
    HANDLE file = CreateFileA(path.c_str(), GENERIC_READ | GENERIC_WRITE,
                              FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return nullptr;
    HANDLE mapping = CreateFileMappingA(file, nullptr, PAGE_READWRITE, 0,
                                        sizeof(daw::host::SharedAudioRing), nullptr);
    if (!mapping) {
        CloseHandle(file);
        return nullptr;
    }
    void* view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0,
                               sizeof(daw::host::SharedAudioRing));
    return static_cast<daw::host::SharedAudioRing*>(view);
#else
    const int fd = open(path.c_str(), O_RDWR);
    if (fd < 0) return nullptr;
    void* view = mmap(nullptr, sizeof(daw::host::SharedAudioRing),
                      PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (view == MAP_FAILED) {
        close(fd);
        return nullptr;
    }
    return static_cast<daw::host::SharedAudioRing*>(view);
#endif
}

int runServe(const std::string& segment_path, const std::string& module_path,
             const std::string& uid_str, long long parent_pid, bool editor) {
    using namespace Steinberg;

    // Engine-death watch (c-2): a hard-killed engine cannot raise the
    // shutdown flag; without this the child spins forever (observed: an
    // orphan held plugin_host.exe locked). A parent that cannot even be
    // opened is treated as already dead.
#ifdef _WIN32
    HANDLE parent_handle = nullptr;
    if (parent_pid > 0) {
        parent_handle = OpenProcess(SYNCHRONIZE, FALSE,
                                    static_cast<DWORD>(parent_pid));
        if (!parent_handle) {
            std::cerr << "plugin_host: parent " << parent_pid
                      << " not reachable - exiting" << std::endl;
            return 0;
        }
    }
    auto parentDead = [&]() {
        return parent_handle &&
               WaitForSingleObject(parent_handle, 0) == WAIT_OBJECT_0;
    };
#else
    auto parentDead = [&]() {
        return parent_pid > 0 &&
               kill(static_cast<pid_t>(parent_pid), 0) == -1 && errno == ESRCH;
    };
    if (parent_pid > 0 && parentDead()) {
        std::cerr << "plugin_host: parent " << parent_pid
                  << " not reachable - exiting" << std::endl;
        return 0;
    }
#endif

    daw::host::SharedAudioRing* ring = mapSegment(segment_path);
    if (!ring) {
        std::cerr << "plugin_host error: cannot map segment: " << segment_path << std::endl;
        return 1;
    }
    if (ring->magic != daw::host::kRingMagic ||
        ring->layout_version != daw::host::kLayoutVersion ||
        ring->block_size != daw::host::kRingBlockSize) {
        std::cerr << "plugin_host error: segment contract mismatch (magic="
                  << ring->magic << " layout=" << ring->layout_version
                  << " block=" << ring->block_size << ")" << std::endl;
        return 1;
    }

    PluginInstance inst;
    std::string err;
    if (!inst.setup(module_path, uid_str, static_cast<double>(ring->sample_rate), err)) {
        std::cerr << "plugin_host error: " << err << std::endl;
        return 1;
    }

    // 2.5-etat: restore state placed by the engine BEFORE the heartbeat
    // says ready (processor-first by construction - only IComponent
    // exists in this host). A refused/corrupt blob is a WARNING, not a
    // death: the plugin then starts from its defaults, audibly.
    const std::string state_path = segment_path + ".state";
    {
        std::vector<uint8_t> comp;
        if (daw::host::readStateFile(state_path, comp) && !comp.empty()) {
            BlobStream stream(std::move(comp));
            if (inst.component->setState(&stream) == Steinberg::kResultOk) {
                std::cerr << "plugin_host: state restored ("
                          << stream.data().size() << " bytes)" << std::endl;
            } else {
                std::cerr << "plugin_host warning: setState refused - defaults kept"
                          << std::endl;
            }
        }
    }

    // v11 : le controleur d'edition + la table MIDI->parametre, acquis
    // APRES la restauration d'etat (le controleur se synchronise sur
    // l'etat restaure) et AVANT toute fenetre (qui l'emprunte). Toutes
    // plateformes : le mapping MIDI ne depend pas d'une fenetre.
    inst.acquireController();
    std::bitset<16 * MidiParamMap::kSlots> midi_unmapped_warned;

    // Fenetrage v1 : la GUI s'ouvre AVANT le pret (elle fait partie de la
    // ceremonie) ; son echec est un WARNING, jamais une mort - le plugin
    // sert l'audio avec ou sans fenetre.
#ifdef _WIN32
    EditorWindow editor_win;
    editor_win.want_flag = &ring->editor_open;  // la croix (X) redescend l'etat
    std::string editor_title = module_path;
    {
        const auto slash = editor_title.find_last_of("/\\");
        if (slash != std::string::npos) editor_title = editor_title.substr(slash + 1);
    }
    if (editor) {
        openEditorGuarded(editor_win, inst.edit.controller, editor_title);
    }
    // v9 : etat DESIRE de la fenetre qu'on a honore en dernier. On agit sur
    // les TRANSITIONS de ring->editor_open (le message kEditor), pas sur le
    // niveau : une ouverture qui echoue (plugin headless) n'est PAS reessayee
    // a chaque tour - seulement quand l'utilisateur re-bascule.
    bool last_editor_want = editor;
#else
    (void)editor;
#endif

    // PDC ecrivain (v7) : la latence du plugin AVANT le pret - le
    // bridge peut la lire des que le heartbeat dit ready
    ring->plugin_latency_samples.store(inst.latency_samples,
                                       std::memory_order_release);

    // Ready signal: the bridge's start() waits for a nonzero heartbeat
    ring->child_heartbeat.store(1, std::memory_order_release);
#ifdef _WIN32
    // Vague 3 (mesure 2026-08-28, MiniLab sur Dexed en exclusif 256) : en
    // priorite NORMALE, le thread serve ratait ~46-58 % des blocs meme
    // sans note (le yield-spin cede le coeur a n'importe qui) -> blocs
    // DRY = gresillement audible. La pratique DAW standard : MMCSS
    // « Pro Audio » (le meme registre que le thread audio du moteur via
    // miniaudio), CRITICAL. Echec = fallback TIME_CRITICAL classique,
    // jamais un refus (le plugin sert quand meme).
    {
        DWORD task_index = 0;
        HANDLE mm = AvSetMmThreadCharacteristicsA("Pro Audio", &task_index);
        if (mm) {
            AvSetMmThreadPriority(mm, AVRT_PRIORITY_CRITICAL);
            std::cerr << "plugin_host: serve thread MMCSS Pro Audio (critical)" << std::endl;
        } else if (SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL)) {
            std::cerr << "plugin_host: serve thread TIME_CRITICAL (MMCSS unavailable)" << std::endl;
        } else {
            std::cerr << "plugin_host warning: could not raise serve thread priority" << std::endl;
        }
    }
#endif
    std::cerr << "plugin_host: serving on " << segment_path << " at "
              << ring->sample_rate << " Hz" << std::endl;

    uint64_t last_in = 0;
    uint64_t beats = 1;
    uint64_t idle_spins = 0;

    // 2.5-etat: serve a pending save request (control-plane, latency
    // tolerant - a serialize may cost a block, counted engine-side)
    auto serveStateRequest = [&]() {
        const uint64_t req = ring->state_request_seq.load(std::memory_order_acquire);
        if (req == ring->state_ready_seq.load(std::memory_order_relaxed)) return;
        BlobStream stream;
        if (inst.component->getState(&stream) == Steinberg::kResultOk &&
            daw::host::writeStateFile(state_path, stream.data())) {
            std::cerr << "plugin_host: state saved (" << stream.data().size()
                      << " bytes)" << std::endl;
        } else {
            std::cerr << "plugin_host warning: getState/save failed" << std::endl;
            // The file may still hold the spawn-time RESTORE blob: remove
            // it so the bridge reads absence, never stale bytes as fresh.
            std::remove(state_path.c_str());
        }
        // Always answer (even on failure): the bridge's bounded wait must
        // not run its full timeout for a plugin that refuses getState -
        // the absent file at ready IS the failure signal.
        ring->state_ready_seq.store(req, std::memory_order_release);
    };

    while (ring->shutdown.load(std::memory_order_acquire) == 0) {
        serveStateRequest();
#ifdef _WIN32
        // v9 : fenetre GUI a la demande. Le moteur ecrit l'etat desire sur le
        // message kEditor ; on ouvre/ferme sur la transition (meme thread que
        // le pump - la fenetre appartient a ce thread).
        {
            const bool want = ring->editor_open.load(std::memory_order_acquire) != 0;
            if (want != last_editor_want) {
                last_editor_want = want;
                if (want) {
                    openEditorGuarded(editor_win, inst.edit.controller, editor_title);
                } else {
                    editor_win.close();
                }
            }
        }
        editor_win.pump();  // meme thread, cout borne (PeekMessage draine)
#endif
        const uint64_t newest = ring->input_seq.load(std::memory_order_acquire);
        if (newest == last_in) {
#ifdef _WIN32
            // Fenetrage : a l'ARRET, pas de bloc pour porter les edits
            // GUI - flush officiel numSamples==0 (intrants 2.5, mecanique
            // 4) pour qu'ils entrent au COMPOSANT, puis signal moteur.
            if (!editor_win.handler.pending.empty()) {
                Vst::ParameterChanges flush_changes;
                flush_changes.setMaxParameters(daw::host::kParamQueueSlots);
                for (const auto& [gid, gval] : editor_win.handler.pending) {
                    int32 qi = 0;
                    auto* q = flush_changes.addParameterData(gid, qi);
                    if (q) { int32 pi = 0; q->addPoint(0, gval, pi); }
                }
                editor_win.handler.pending.clear();
                Vst::ProcessData flush{};
                flush.processMode = Vst::kRealtime;
                flush.symbolicSampleSize = Vst::kSample32;
                flush.numSamples = 0;
                flush.inputParameterChanges = &flush_changes;
                inst.processor->process(flush);
                ring->gui_edit_seq.fetch_add(1, std::memory_order_release);
            }
#endif
            // Deliberate yield-spin: the block budget is 5.3 ms and Windows
            // sleep granularity (up to 15.6 ms) can eat it whole. One busy
            // core on a 32-thread machine is the cheap side of that trade.
            // Dated debt: waitable event if this child ever shares a small
            // machine.
            if ((++idle_spins & 0x3FF) == 0 && parentDead()) {
                std::cerr << "plugin_host: engine gone - exiting" << std::endl;
                inst.teardown();
                return 0;
            }
            std::this_thread::yield();
            continue;
        }
        // Process the whole backlog IN ORDER: the driver deposits bursts of
        // blocks-per-callback back-to-back, and EVERY one of them will be
        // collected depth blocks later - skipping to the newest starves the
        // consumer (first live run measured 534/1875 dry blocks). If truly
        // behind, only the last kRingSlots-2 deposits still have intact
        // slots; older ones were overwritten and already bypassed.
        uint64_t s = last_in + 1;
        if (newest >= s + (daw::host::kRingSlots - 2)) {
            s = newest - (daw::host::kRingSlots - 2) + 1;
        }
        last_in = newest;
        for (; s <= newest &&
               ring->shutdown.load(std::memory_order_acquire) == 0; ++s) {
        const uint64_t seq = s;
        const uint32_t slot = static_cast<uint32_t>(seq % daw::host::kRingSlots);

        // v10 : l'entree de CE slot est-elle encore celle de seq ?
        // (l'engine a pu la recouvrir si on est tres en retard - la
        // traiter serait calculer sur un bloc futur et le publier sous
        // un mauvais numero). Skip : l'engine sert dry et compte.
        if (ring->in_slot_seq[slot].load(std::memory_order_acquire) != seq) {
            // Diagnostic (borne) : combien de blocs l'enfant saute parce que
            // l'engine a deja recouvert leur entree (= il est en retard de
            // plus de kRingSlots blocs)
            static uint32_t skipped_logged = 0;
            if (skipped_logged < 20) {
                ++skipped_logged;
                std::cerr << "plugin_host: input of seq " << seq << " already overwritten (slot stamp "
                          << ring->in_slot_seq[slot].load(std::memory_order_relaxed)
                          << ", newest " << newest << ") - skipped" << std::endl;
            }
            continue;
        }

        // v5 FIFO drain (see shared_audio_ring.h): EVERY pending pair
        // lands in this block's IParameterChanges - a rebuild's burst of
        // N params arrives whole, not just its last survivor.
        Vst::ParameterChanges param_changes;
        param_changes.setMaxParameters(daw::host::kParamQueueSlots);
        while (true) {
            uint64_t r = ring->param_read_idx.load(std::memory_order_relaxed);
            if (r >= ring->param_write_idx.load(std::memory_order_acquire)) break;
            const uint32_t qslot = static_cast<uint32_t>(r % daw::host::kParamQueueSlots);
            const uint32_t id = ring->param_ids[qslot];
            const double value = ring->param_values[qslot];
            // Claim the slot BEFORE trusting the pair: if the writer
            // overwrote it mid-read (full-queue race), the CAS fails and
            // the fresh value follows on the next iteration.
            if (!ring->param_read_idx.compare_exchange_strong(
                    r, r + 1, std::memory_order_acq_rel)) {
                continue;  // writer advanced us past an overwritten slot
            }
            int32 queue_index = 0;
            auto* queue = param_changes.addParameterData(id, queue_index);
            if (queue) {
                int32 point_index = 0;
                queue->addPoint(0, value, point_index);
            }
        }
#ifdef _WIN32
        // Fenetrage v1 : les tweaks GUI (coalesces par id) rejoignent les
        // changements de ce bloc - meme thread que la pompe, zero verrou.
        // Le bump previent le moteur (capture d'etat debouncee : le
        // reglage survivra et voyagera).
        if (!editor_win.handler.pending.empty()) {
            for (const auto& [gid, gval] : editor_win.handler.pending) {
                int32 queue_index = 0;
                auto* queue = param_changes.addParameterData(gid, queue_index);
                if (queue) {
                    int32 point_index = 0;
                    queue->addPoint(0, gval, point_index);
                }
            }
            editor_win.handler.pending.clear();
            ring->gui_edit_seq.fetch_add(1, std::memory_order_release);
        }
#endif

        // v8 MIDI, GENERIQUE v11 : draine le FIFO d'evenements de CE bloc
        // (popMidiEvent = le SEUL decodeur, partage avec le gtest). Notes
        // -> IEventList (le canal qui fait SONNER un instrument) ; CC et
        // pitch-bend -> IParameterChanges via la table IMidiMapping (VST3
        // n'a pas d'evenement CC). Non declare par le plugin = ignore,
        // compte une fois par (canal, controleur).
        Vst::EventList event_list{static_cast<int32>(daw::host::kMidiQueueSlots)};
        daw::host::MidiEvent mev;
        while (daw::host::popMidiEvent(ring, mev)) {
            const int32 off = static_cast<int32>(mev.sample_offset);
            switch (mev.kind) {
                case daw::host::MidiKind::NoteOn:
                case daw::host::MidiKind::NoteOff: {
                    Vst::Event ev{};
                    ev.busIndex = 0;
                    ev.sampleOffset = off;
                    ev.flags = Vst::Event::kIsLive;
                    if (mev.kind == daw::host::MidiKind::NoteOn) {
                        ev.type = Vst::Event::kNoteOnEvent;
                        ev.noteOn.channel = mev.channel;
                        ev.noteOn.pitch = mev.data1;
                        ev.noteOn.velocity = static_cast<float>(mev.data2) / 127.0f;
                        ev.noteOn.noteId = -1;
                        // Diagnostic (borne a 40 lignes) : ou atterrit chaque
                        // note-on - transitoire « note muette apres rebuild »
                        static uint32_t noteon_logged = 0;
                        if (noteon_logged < 40) {
                            ++noteon_logged;
                            std::cerr << "plugin_host: note-on " << int(mev.data1)
                                      << " v" << int(mev.data2) << " in block seq " << seq
                                      << " (newest " << newest << ")" << std::endl;
                        }
                    } else {
                        ev.type = Vst::Event::kNoteOffEvent;
                        ev.noteOff.channel = mev.channel;
                        ev.noteOff.pitch = mev.data1;
                        ev.noteOff.velocity = static_cast<float>(mev.data2) / 127.0f;
                        ev.noteOff.noteId = -1;
                    }
                    event_list.addEvent(ev);
                    break;
                }
                case daw::host::MidiKind::ControlChange:
                case daw::host::MidiKind::PitchBend: {
                    const bool bend = mev.kind == daw::host::MidiKind::PitchBend;
                    const int cc = bend ? Vst::kPitchBend : mev.data1;
                    const Vst::ParamID pid = inst.midi_map.lookup(mev.channel, cc);
                    if (pid == Vst::kNoParamId) {
                        const size_t key = mev.channel * MidiParamMap::kSlots + cc;
                        if (key < midi_unmapped_warned.size() && !midi_unmapped_warned[key]) {
                            midi_unmapped_warned[key] = true;
                            std::cerr << "plugin_host: midi " << (bend ? "pitch-bend" : "cc")
                                      << (bend ? "" : " " + std::to_string(cc))
                                      << " ch" << int(mev.channel)
                                      << " not mapped by the plugin - dropped" << std::endl;
                        }
                        break;
                    }
                    const double norm = bend
                        ? static_cast<double>(daw::host::midiPitchBend14(mev.data1, mev.data2)) / 16383.0
                        : static_cast<double>(mev.data2) / 127.0;
                    int32 queue_index = 0;
                    auto* queue = param_changes.addParameterData(pid, queue_index);
                    if (queue) {
                        int32 point_index = 0;
                        queue->addPoint(off, norm, point_index);
                    }
                    break;
                }
            }
        }

        // Zero-copy: VST3 channel pointers aim straight into the segment
        float* in_ch[2] = {ring->in[slot][0], ring->in[slot][1]};
        float* out_ch[2] = {ring->out[slot][0], ring->out[slot][1]};
        Vst::AudioBusBuffers in_bus{};
        in_bus.numChannels = 2;
        in_bus.channelBuffers32 = in_ch;
        Vst::AudioBusBuffers out_bus{};
        out_bus.numChannels = 2;
        out_bus.channelBuffers32 = out_ch;

        Vst::ProcessData data{};
        data.processMode = Vst::kRealtime;
        data.symbolicSampleSize = Vst::kSample32;
        data.numSamples = kHostBlockSize;
        // v8 : un instrument declare 0 bus d'entree audio -> numInputs 0,
        // inputs nullptr (passer un bus fantome fait echouer les plugins
        // stricts). L'audio de l'instrument vient des notes, pas de l'entree.
        data.numInputs = inst.num_audio_in;
        data.numOutputs = 1;
        data.inputs = inst.num_audio_in > 0 ? &in_bus : nullptr;
        data.outputs = &out_bus;
        data.inputParameterChanges = &param_changes;
        data.inputEvents = &event_list;  // v8 : les notes du bloc -> l'instrument

        // v12 : ProcessContext - ce que le plugin sait du transport (AUDIT-6
        // §6 : sans lui, delays synchronises / arpegiateurs / LFO tournent
        // sur leur defaut). Position DU BLOC (par slot), tempo et play
        // (globaux), temps musical en noires derive du tempo entier ; la
        // signature reste 4/4 tant que le document ne la porte pas ici.
        Vst::ProcessContext ctx{};
        {
            const int64_t pos = ring->in_slot_pos[slot].load(std::memory_order_relaxed);
            const int64_t milli = ring->transport_tempo_milli_bpm.load(std::memory_order_relaxed);
            const bool playing = ring->transport_playing.load(std::memory_order_relaxed) != 0;
            const double sr = static_cast<double>(ring->sample_rate);
            ctx.sampleRate = sr;
            ctx.projectTimeSamples = pos;
            ctx.continousTimeSamples = static_cast<int64>(seq) * static_cast<int64>(kHostBlockSize);
            ctx.state = Vst::ProcessContext::kContTimeValid | Vst::ProcessContext::kProjectTimeMusicValid;
            if (playing) ctx.state |= Vst::ProcessContext::kPlaying;
            if (milli > 0) {
                ctx.tempo = static_cast<double>(milli) / 1000.0;
                ctx.state |= Vst::ProcessContext::kTempoValid;
                ctx.projectTimeMusic = (static_cast<double>(pos) / sr) * (ctx.tempo / 60.0);
                ctx.timeSigNumerator = 4;
                ctx.timeSigDenominator = 4;
                ctx.state |= Vst::ProcessContext::kTimeSigValid;
                ctx.barPositionMusic = std::floor(ctx.projectTimeMusic / 4.0) * 4.0;
                ctx.state |= Vst::ProcessContext::kBarPositionValid;
            }
        }
        data.processContext = &ctx;

        if (inst.processor->process(data) != kResultOk) {
            std::cerr << "plugin_host error: process refused at seq " << seq << std::endl;
            inst.teardown();
            return 1;
        }

        // v10 (invariant input-dechire) : si l'engine a recouvert
        // in[slot] PENDANT le process (zero-copy : detectable, pas
        // empechable), la sortie est un melange de deux blocs - on ne
        // la publie PAS (pas d'estampille : l'engine sert dry et
        // compte). Le heartbeat avance quand meme (l'enfant est vivant).
        if (ring->in_slot_seq[slot].load(std::memory_order_acquire) == seq) {
            ring->out_slot_seq[slot].store(seq, std::memory_order_release);
        } else {
            static uint32_t torn_logged = 0;
            if (torn_logged < 20) {
                ++torn_logged;
                std::cerr << "plugin_host: output of seq " << seq
                          << " NOT published (input torn during process)" << std::endl;
            }
        }
        ring->output_seq.store(seq, std::memory_order_release);
        ring->child_heartbeat.store(++beats, std::memory_order_release);
        }  // backlog loop
    }

#ifdef _WIN32
    editor_win.close();
#endif
    inst.teardown();
    std::cerr << "plugin_host: clean shutdown after " << (beats - 1) << " blocks" << std::endl;
    return 0;
}

// Vague 3 (2026-08-28) : `--params <module> --uid <uid>` - la liste des
// parametres du plugin (id, titre, unites, defaut normalise, drapeaux)
// en TSV sur stdout. C'est la cle qui permet de MANIPULER un plugin sans
// sa fenetre : `params: [{key: "<id>", value}]` dans le document (le
// moteur pousse par le FIFO param du ring -> IParameterChanges). Meme
// ceremonie que --process/--serve (headless), controleur acquis pour
// lire IEditController.
int runParams(const std::string& module_path, const std::string& uid_str) {
    using namespace Steinberg;
    PluginInstance inst;
    std::string err;
    if (!inst.setup(module_path, uid_str, 48000.0, err)) {
        std::cerr << "plugin_host error: " << err << std::endl;
        return 1;
    }
    inst.acquireController();
    auto* ctrl = inst.edit.controller.get();
    if (!ctrl) {
        std::cerr << "plugin_host error: no edit controller (headless plugin)" << std::endl;
        inst.teardown();
        return 1;
    }
    const int32 n = ctrl->getParameterCount();
    std::cout << "id\ttitle\tunits\tdefault\tsteps\tflags\n";
    for (int32 i = 0; i < n; ++i) {
        Vst::ParameterInfo info{};
        if (ctrl->getParameterInfo(i, info) != kResultOk) continue;
        // UTF-16 -> ASCII (portable : la CI Linux compile ce fichier ;
        // les titres de parametres sont ASCII en pratique)
        auto ascii = [](const Vst::TChar* s) {
            std::string out;
            for (; s && *s; ++s) out += (*s < 128) ? static_cast<char>(*s) : '?';
            return out;
        };
        std::cout << info.id << '\t' << ascii(info.title) << '\t' << ascii(info.units) << '\t'
                  << info.defaultNormalizedValue << '\t' << info.stepCount << '\t'
                  << ((info.flags & Vst::ParameterInfo::kCanAutomate) ? "auto" : "")
                  << ((info.flags & Vst::ParameterInfo::kIsReadOnly) ? " ro" : "")
                  << ((info.flags & Vst::ParameterInfo::kIsBypass) ? " bypass" : "")
                  << ((info.flags & Vst::ParameterInfo::kIsList) ? " list" : "")
                  << '\n';
    }
    std::cerr << "plugin_host: " << n << " parameter(s)" << std::endl;
    inst.teardown();
    return 0;
}

}  // namespace

int runEnumerate(const std::string& path);

int main(int argc, char* argv[]) {
    const std::string mode = (argc >= 2) ? argv[1] : "";

    if (mode == "--enumerate" && argc == 3) {
        return runEnumerate(argv[2]);
    }
    if (mode == "--params" && argc == 5 && std::string(argv[3]) == "--uid") {
        return runParams(argv[2], argv[4]);
    }

    if (mode == "--serve") {
        // Calling convention fixed by PluginBridge::spawnChild - the two
        // sides of this command line live in two executables
        std::string segment_path, module_path, uid;
        long long parent_pid = 0;
        bool editor = false;
        bool args_ok = (argc >= 3);
        if (args_ok) segment_path = argv[2];
        for (int i = 3; i < argc && args_ok; ++i) {
            const std::string a = argv[i];
            if (a == "--editor") { editor = true; continue; }  // drapeau seul
            if (i + 1 >= argc) { args_ok = false; break; }
            const std::string v = argv[++i];
            if (a == "--module") module_path = v;
            else if (a == "--uid") uid = v;
            else if (a == "--parent") parent_pid = std::stoll(v);
            else args_ok = false;
        }
        if (args_ok && !module_path.empty() && !uid.empty()) {
            return runServe(segment_path, module_path, uid, parent_pid, editor);
        }
    }

    if (mode == "--process") {
        std::string module_path, uid, in_path, out_path;
        bool has_param = false;
        uint32_t param_id = 0;
        double param_value = 0.0;
        bool args_ok = (argc >= 3);
        if (args_ok) module_path = argv[2];
        for (int i = 3; i + 1 < argc && args_ok; i += 2) {
            const std::string a = argv[i];
            const std::string v = argv[i + 1];
            if (a == "--uid") uid = v;
            else if (a == "--in") in_path = v;
            else if (a == "--out") out_path = v;
            else if (a == "--param") {
                const auto colon = v.find(':');
                if (colon == std::string::npos) { args_ok = false; break; }
                param_id = static_cast<uint32_t>(std::stoul(v.substr(0, colon)));
                param_value = std::stod(v.substr(colon + 1));
                has_param = true;
            } else args_ok = false;
        }
        if (args_ok && !uid.empty() && !in_path.empty() && !out_path.empty()) {
            return runProcess(module_path, uid, has_param, param_id, param_value,
                              in_path, out_path);
        }
    }

    std::cerr << "Usage:\n"
              << "  plugin_host --enumerate <path.vst3>\n"
              << "  plugin_host --process <path.vst3> --uid <hex32> --in <in.wav> --out <out.wav> [--param <id>:<norm>]\n"
              << "  plugin_host --serve <segment.shm> --module <path.vst3> --uid <hex32> [--parent <pid>]"
              << std::endl;
    return 2;
}

int runEnumerate(const std::string& path) {

    daw::host::HostResponse resp;

    std::string error;
    auto module = VST3::Hosting::Module::create(path, error);
    if (!module) {
        return fail(resp, error.empty() ? "Failed to load module: " + path : error);
    }

    auto* enu = resp.mutable_enumerate();
    enu->set_module_path(path);

    const auto& factory = module->getFactory();
    for (const auto& info : factory.classInfos()) {
        auto* c = enu->add_classes();
        c->set_name(info.name());
        c->set_category(info.category());
        c->set_class_id(info.ID().toString());
        c->set_vendor(info.vendor());
        c->set_version(info.version());
        c->set_sub_categories(info.subCategoriesString());
        std::cerr << "class: " << info.name() << " [" << info.category()
                  << "] uid=" << info.ID().toString() << std::endl;
    }

    enu->set_ok(true);
    if (!writeResponse(resp)) {
        std::cerr << "plugin_host error: failed to write response" << std::endl;
        return 1;
    }
    return 0;
}
