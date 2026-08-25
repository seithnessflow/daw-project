// SPDX-License-Identifier: GPL-3.0-or-later
// v8 MIDI : fabrique un doc "clip MIDI + instrument" pour tester que le
// chemin notes -> instrument -> son marche de bout en bout.
//
// Usage : create_midi_doc <output.am> <instrument_uid> [duration_s=2]
//   ex : create_midi_doc midi.am ABCDEF019182FAEB4447534244657864  (Dexed)

#include "../src/document/automerge_document.h"
#include "../src/document/schema.h"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: " << argv[0]
                  << " <output.am> <instrument_uid> [duration_s=2]\n";
        return 1;
    }
    const std::string out_path = argv[1];
    const std::string uid = argv[2];
    const int dur_s = (argc > 3) ? std::atoi(argv[3]) : 2;
    const int64_t SR = 48000;

    daw::document::AutomergeDocument doc;
    if (!doc.create(static_cast<uint32_t>(SR))) {
        std::cerr << "create failed: " << doc.getLastError() << "\n";
        return 1;
    }

    daw::document::TrackDef track;
    track.id = "track-midi";
    track.name = "MIDI";
    track.gain = 1.0f;

    // Clip MIDI : pas d'asset (asset_hash vide) -> pas d'audio en entree,
    // l'instrument genere le son a partir des notes.
    daw::document::ClipDef clip;
    clip.id = "clip-midi";
    clip.start_sample = 0;
    clip.length_samples = static_cast<int64_t>(dur_s) * SR;

    // Un accord do-mi-sol (60/64/67), tenu ~1 s, puis une note plus haute.
    clip.notes.push_back({60, 110, 0, SR});          // do central
    clip.notes.push_back({64, 100, 0, SR});          // mi
    clip.notes.push_back({67, 100, 0, SR});          // sol
    clip.notes.push_back({72, 110, SR, SR / 2});     // do aigu, 2e temps
    track.clips.push_back(clip);

    // L'instrument en tete de chaine (le premier vst3 recoit les notes).
    daw::document::ProcessorDef inst;
    inst.id = "proc-inst";
    inst.type = "vst3";
    inst.uid = uid;
    track.chain.push_back(inst);

    doc.addTrack(track);

    std::vector<uint8_t> bytes = doc.toBytes();
    if (bytes.empty()) {
        std::cerr << "serialization failed\n";
        return 1;
    }
    std::ofstream f(out_path, std::ios::binary);
    f.write(reinterpret_cast<const char*>(bytes.data()),
            static_cast<std::streamsize>(bytes.size()));
    std::cout << "wrote " << out_path << " (" << bytes.size()
              << " bytes) : 1 piste, clip MIDI 4 notes, instrument uid=" << uid
              << "\n";
    return 0;
}
