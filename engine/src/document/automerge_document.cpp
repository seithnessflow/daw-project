#include "automerge_document.h"

extern "C" {
#include <automerge-c/automerge.h>
#include <automerge-c/utils/string.h>
}

#include <algorithm>
#include <cstring>
#include <fstream>
#include <vector>

namespace daw::document {

AutomergeDocument::AutomergeDocument() = default;

AutomergeDocument::~AutomergeDocument() {
    cleanup();
}

AutomergeDocument::AutomergeDocument(AutomergeDocument&& other) noexcept
    : doc_(other.doc_)
    , doc_result_(other.doc_result_)
    , last_error_(std::move(other.last_error_))
    , change_callback_(std::move(other.change_callback_))
    , sync_state_(other.sync_state_)
{
    other.doc_ = nullptr;
    other.doc_result_ = nullptr;
    other.sync_state_ = nullptr;
}

AutomergeDocument& AutomergeDocument::operator=(AutomergeDocument&& other) noexcept {
    if (this != &other) {
        cleanup();
        doc_ = other.doc_;
        doc_result_ = other.doc_result_;
        last_error_ = std::move(other.last_error_);
        change_callback_ = std::move(other.change_callback_);
        sync_state_ = other.sync_state_;
        other.doc_ = nullptr;
        other.doc_result_ = nullptr;
        other.sync_state_ = nullptr;
    }
    return *this;
}

void AutomergeDocument::cleanup() {
    if (doc_result_) {
        AMresultFree(doc_result_);
        doc_result_ = nullptr;
    }
    doc_ = nullptr;
    if (sync_state_) {
        sync_state_ = nullptr;
    }
}

bool AutomergeDocument::checkResult(AMresult* result, const char* context) {
    if (!result) {
        last_error_ = std::string(context) + ": null result";
        return false;
    }

    AMstatus status = AMresultStatus(result);
    if (status != AM_STATUS_OK) {
        AMbyteSpan errSpan = AMresultError(result);
        if (errSpan.src && errSpan.count > 0) {
            last_error_ = std::string(context) + ": " +
                std::string(reinterpret_cast<const char*>(errSpan.src), errSpan.count);
        } else {
            last_error_ = std::string(context) + ": unknown error";
        }
        AMresultFree(result);
        return false;
    }

    return true;
}

bool AutomergeDocument::create(uint32_t sample_rate) {
    cleanup();

    // Create new document
    AMresult* result = AMcreate(nullptr);
    if (!checkResult(result, "AMcreate")) {
        return false;
    }

    // Extract document from result - keep result alive!
    AMitem* item = AMresultItem(result);
    if (!AMitemToDoc(item, &doc_)) {
        last_error_ = "Failed to get document from result";
        AMresultFree(result);
        return false;
    }

    if (!doc_) {
        last_error_ = "Failed to get document from result";
        AMresultFree(result);
        return false;
    }

    // Store the result - it owns the document memory
    doc_result_ = result;

    // Initialize with default structure
    ProjectDef def;
    def.schema_version = SCHEMA_VERSION;
    def.sample_rate = sample_rate;

    if (!writeDocument(def)) {
        cleanup();
        return false;
    }

    notifyChange();
    return true;
}

bool AutomergeDocument::loadFromFile(const std::string& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) {
        last_error_ = "Failed to open file: " + path;
        return false;
    }

    std::streamsize size = file.tellg();
    file.seekg(0, std::ios::beg);

    std::vector<uint8_t> data(size);
    if (!file.read(reinterpret_cast<char*>(data.data()), size)) {
        last_error_ = "Failed to read file: " + path;
        return false;
    }

    return loadFromBytes(data.data(), data.size());
}

bool AutomergeDocument::loadFromBytes(const uint8_t* data, size_t size) {
    cleanup();

    AMresult* result = AMload(data, size);
    if (!checkResult(result, "AMload")) {
        return false;
    }

    // Extract document from result - keep result alive!
    AMitem* item = AMresultItem(result);
    if (!AMitemToDoc(item, &doc_)) {
        last_error_ = "Failed to get document from load result";
        AMresultFree(result);
        return false;
    }

    if (!doc_) {
        last_error_ = "Failed to get document from load result";
        AMresultFree(result);
        return false;
    }

    // Store the result - it owns the document memory
    doc_result_ = result;

    // Validate by reading
    ProjectDef def;
    if (!readDocument(def)) {
        last_error_ = "Failed to read document structure: " + last_error_;
        cleanup();
        return false;
    }

    // TODO: Migrate schema if needed (when we have multiple schema versions)

    notifyChange();
    return true;
}

bool AutomergeDocument::saveToFile(const std::string& path) const {
    std::vector<uint8_t> data = toBytes();
    if (data.empty()) {
        return false;
    }

    std::ofstream file(path, std::ios::binary);
    if (!file) {
        return false;
    }

    file.write(reinterpret_cast<const char*>(data.data()), data.size());
    return file.good();
}

std::vector<uint8_t> AutomergeDocument::toBytes() const {
    if (!doc_) {
        return {};
    }

    AMresult* result = AMsave(doc_);
    if (!result || AMresultStatus(result) != AM_STATUS_OK) {
        if (result) AMresultFree(result);
        return {};
    }

    // Get bytes from result items
    AMitems items = AMresultItems(result);
    AMitem* item = AMitemsNext(&items, 1);

    AMbyteSpan bytes;
    if (!item || !AMitemToBytes(item, &bytes)) {
        AMresultFree(result);
        return {};
    }

    std::vector<uint8_t> data(bytes.src, bytes.src + bytes.count);
    AMresultFree(result);

    return data;
}

bool AutomergeDocument::applyChange(const uint8_t* change_data, size_t size) {
    if (!doc_) {
        last_error_ = "No document loaded";
        return false;
    }

    // Load the change first
    AMresult* changeResult = AMchangeFromBytes(change_data, size);
    if (!checkResult(changeResult, "AMchangeFromBytes")) {
        return false;
    }

    // Get items from result and apply
    AMitems items = AMresultItems(changeResult);
    AMresult* applyResult = AMapplyChanges(doc_, &items);
    AMresultFree(changeResult);

    if (!checkResult(applyResult, "AMapplyChanges")) {
        return false;
    }
    AMresultFree(applyResult);

    notifyChange();
    return true;
}

std::vector<uint8_t> AutomergeDocument::generateSyncMessage() {
    // Simplified - full sync would use AMsyncState
    return {};
}

bool AutomergeDocument::receiveSyncMessage(const uint8_t* /*message*/, size_t /*size*/) {
    // Simplified - full sync would use AMsyncState
    return true;
}

ProjectDef AutomergeDocument::getDocument() const {
    ProjectDef def;
    if (doc_ && !readDocument(def)) {
        def = ProjectDef{};  // Return empty on error
    }
    return def;
}

bool AutomergeDocument::readDocument(ProjectDef& out) const {
    if (!doc_) {
        return false;
    }

    out = ProjectDef{};
    out.schema_version = SCHEMA_VERSION;
    out.sample_rate = 48000;

    // Read schemaVersion
    AMresult* result = AMmapGet(doc_, AM_ROOT, AMstr("schemaVersion"), nullptr);
    if (result && AMresultStatus(result) == AM_STATUS_OK) {
        AMitem* item = AMresultItem(result);
        uint64_t val;
        if (AMitemToUint(item, &val)) {
            out.schema_version = static_cast<uint32_t>(val);
        }
    }
    if (result) AMresultFree(result);

    // Read sampleRate
    result = AMmapGet(doc_, AM_ROOT, AMstr("sampleRate"), nullptr);
    if (result && AMresultStatus(result) == AM_STATUS_OK) {
        AMitem* item = AMresultItem(result);
        uint64_t val;
        if (AMitemToUint(item, &val)) {
            out.sample_rate = static_cast<uint32_t>(val);
        }
    }
    if (result) AMresultFree(result);

    // Read tracks array
    result = AMmapGet(doc_, AM_ROOT, AMstr("tracks"), nullptr);
    if (result && AMresultStatus(result) == AM_STATUS_OK) {
        AMitem* tracksItem = AMresultItem(result);
        if (AMitemValType(tracksItem) == AM_VAL_TYPE_OBJ_TYPE) {
            const AMobjId* tracksId = AMitemObjId(tracksItem);

            // Get number of tracks
            size_t numTracks = AMobjSize(doc_, tracksId, nullptr);

            for (size_t i = 0; i < numTracks; ++i) {
                TrackDef track;

                AMresult* trackResult = AMlistGet(doc_, tracksId, i, nullptr);
                if (trackResult && AMresultStatus(trackResult) == AM_STATUS_OK) {
                    AMitem* trackItem = AMresultItem(trackResult);
                    if (AMitemValType(trackItem) == AM_VAL_TYPE_OBJ_TYPE) {
                        const AMobjId* trackId = AMitemObjId(trackItem);

                        // Read track fields
                        AMresult* r;
                        AMbyteSpan strVal;
                        double f64Val;

                        r = AMmapGet(doc_, trackId, AMstr("id"), nullptr);
                        if (r && AMresultStatus(r) == AM_STATUS_OK) {
                            AMitem* it = AMresultItem(r);
                            if (AMitemToStr(it, &strVal)) {
                                track.id = std::string(reinterpret_cast<const char*>(strVal.src), strVal.count);
                            }
                        }
                        if (r) AMresultFree(r);

                        r = AMmapGet(doc_, trackId, AMstr("name"), nullptr);
                        if (r && AMresultStatus(r) == AM_STATUS_OK) {
                            AMitem* it = AMresultItem(r);
                            if (AMitemToStr(it, &strVal)) {
                                track.name = std::string(reinterpret_cast<const char*>(strVal.src), strVal.count);
                            }
                        }
                        if (r) AMresultFree(r);

                        r = AMmapGet(doc_, trackId, AMstr("gain"), nullptr);
                        if (r && AMresultStatus(r) == AM_STATUS_OK) {
                            AMitem* it = AMresultItem(r);
                            if (AMitemToF64(it, &f64Val)) {
                                track.gain = static_cast<float>(f64Val);
                            }
                        }
                        if (r) AMresultFree(r);

                        // Read clips array
                        r = AMmapGet(doc_, trackId, AMstr("clips"), nullptr);
                        if (r && AMresultStatus(r) == AM_STATUS_OK) {
                            AMitem* clipsItem = AMresultItem(r);
                            if (AMitemValType(clipsItem) == AM_VAL_TYPE_OBJ_TYPE) {
                                const AMobjId* clipsId = AMitemObjId(clipsItem);
                                size_t numClips = AMobjSize(doc_, clipsId, nullptr);

                                for (size_t j = 0; j < numClips; ++j) {
                                    ClipDef clip;
                                    AMresult* clipResult = AMlistGet(doc_, clipsId, j, nullptr);
                                    if (clipResult && AMresultStatus(clipResult) == AM_STATUS_OK) {
                                        AMitem* clipItem = AMresultItem(clipResult);
                                        if (AMitemValType(clipItem) == AM_VAL_TYPE_OBJ_TYPE) {
                                            const AMobjId* clipObjId = AMitemObjId(clipItem);

                                            AMresult* cr;
                                            int64_t i64Val;

                                            cr = AMmapGet(doc_, clipObjId, AMstr("id"), nullptr);
                                            if (cr && AMresultStatus(cr) == AM_STATUS_OK) {
                                                AMitem* cit = AMresultItem(cr);
                                                if (AMitemToStr(cit, &strVal)) {
                                                    clip.id = std::string(reinterpret_cast<const char*>(strVal.src), strVal.count);
                                                }
                                            }
                                            if (cr) AMresultFree(cr);

                                            cr = AMmapGet(doc_, clipObjId, AMstr("assetHash"), nullptr);
                                            if (cr && AMresultStatus(cr) == AM_STATUS_OK) {
                                                AMitem* cit = AMresultItem(cr);
                                                if (AMitemToStr(cit, &strVal)) {
                                                    clip.asset_hash = std::string(reinterpret_cast<const char*>(strVal.src), strVal.count);
                                                }
                                            }
                                            if (cr) AMresultFree(cr);

                                            cr = AMmapGet(doc_, clipObjId, AMstr("startSample"), nullptr);
                                            if (cr && AMresultStatus(cr) == AM_STATUS_OK) {
                                                AMitem* cit = AMresultItem(cr);
                                                if (AMitemToInt(cit, &i64Val)) {
                                                    clip.start_sample = i64Val;
                                                }
                                            }
                                            if (cr) AMresultFree(cr);

                                            cr = AMmapGet(doc_, clipObjId, AMstr("lengthSamples"), nullptr);
                                            if (cr && AMresultStatus(cr) == AM_STATUS_OK) {
                                                AMitem* cit = AMresultItem(cr);
                                                if (AMitemToInt(cit, &i64Val)) {
                                                    clip.length_samples = i64Val;
                                                }
                                            }
                                            if (cr) AMresultFree(cr);

                                            cr = AMmapGet(doc_, clipObjId, AMstr("offsetSamples"), nullptr);
                                            if (cr && AMresultStatus(cr) == AM_STATUS_OK) {
                                                AMitem* cit = AMresultItem(cr);
                                                if (AMitemToInt(cit, &i64Val)) {
                                                    clip.offset_samples = i64Val;
                                                }
                                            }
                                            if (cr) AMresultFree(cr);
                                        }
                                    }
                                    if (clipResult) AMresultFree(clipResult);
                                    track.clips.push_back(clip);
                                }
                            }
                        }
                        if (r) AMresultFree(r);

                        // TODO: Read chain (processors) similarly
                    }
                }
                if (trackResult) AMresultFree(trackResult);

                out.tracks.push_back(track);
            }
        }
    }
    if (result) AMresultFree(result);

    return true;
}

bool AutomergeDocument::writeDocument(const ProjectDef& def) {
    if (!doc_) {
        return false;
    }

    // Keep track of all results that need to be freed at the end
    std::vector<AMresult*> results_to_free;

    AMresult* result;

    // Write schemaVersion
    result = AMmapPutUint(doc_, AM_ROOT, AMstr("schemaVersion"), def.schema_version);
    if (!checkResult(result, "write schemaVersion")) {
        for (auto* r : results_to_free) AMresultFree(r);
        return false;
    }
    results_to_free.push_back(result);

    // Write sampleRate
    result = AMmapPutUint(doc_, AM_ROOT, AMstr("sampleRate"), def.sample_rate);
    if (!checkResult(result, "write sampleRate")) {
        for (auto* r : results_to_free) AMresultFree(r);
        return false;
    }
    results_to_free.push_back(result);

    // Create tracks array
    result = AMmapPutObject(doc_, AM_ROOT, AMstr("tracks"), AM_OBJ_TYPE_LIST);
    if (!checkResult(result, "create tracks array")) {
        for (auto* r : results_to_free) AMresultFree(r);
        return false;
    }
    AMresult* tracksResult = result;
    results_to_free.push_back(result);
    const AMobjId* tracksId = AMitemObjId(AMresultItem(tracksResult));

    for (const auto& track : def.tracks) {
        // Add track object to list
        size_t trackPos = AMobjSize(doc_, tracksId, nullptr);
        result = AMlistPutObject(doc_, tracksId, trackPos, true, AM_OBJ_TYPE_MAP);
        if (!checkResult(result, "add track")) continue;
        AMresult* trackResult = result;
        results_to_free.push_back(result);
        const AMobjId* trackObjId = AMitemObjId(AMresultItem(trackResult));

        // Write track fields - these don't need the obj id to stay valid
        result = AMmapPutStr(doc_, trackObjId, AMstr("id"), AMstr(track.id.c_str()));
        if (result) results_to_free.push_back(result);

        result = AMmapPutStr(doc_, trackObjId, AMstr("name"), AMstr(track.name.c_str()));
        if (result) results_to_free.push_back(result);

        result = AMmapPutF64(doc_, trackObjId, AMstr("gain"), track.gain);
        if (result) results_to_free.push_back(result);

        // Create clips array
        result = AMmapPutObject(doc_, trackObjId, AMstr("clips"), AM_OBJ_TYPE_LIST);
        if (result) results_to_free.push_back(result);

        // Create chain array
        result = AMmapPutObject(doc_, trackObjId, AMstr("chain"), AM_OBJ_TYPE_LIST);
        if (result) results_to_free.push_back(result);
    }

    // Commit changes
    result = AMcommit(doc_, AMstr("Initialize document"), nullptr);
    if (result) results_to_free.push_back(result);

    // Free all results
    for (auto* r : results_to_free) {
        AMresultFree(r);
    }

    return true;
}

int AutomergeDocument::findTrackIndex(const std::string& track_id) const {
    ProjectDef def = getDocument();
    for (size_t i = 0; i < def.tracks.size(); ++i) {
        if (def.tracks[i].id == track_id) {
            return static_cast<int>(i);
        }
    }
    return -1;
}

bool AutomergeDocument::setTrackGain(const std::string& track_id, float gain) {
    if (!doc_) {
        last_error_ = "No document loaded";
        return false;
    }

    gain = std::clamp(gain, 0.0f, 2.0f);

    int trackIdx = findTrackIndex(track_id);
    if (trackIdx < 0) {
        last_error_ = "Track not found: " + track_id;
        return false;
    }

    std::vector<AMresult*> results_to_free;

    // Get tracks array
    AMresult* tracksResult = AMmapGet(doc_, AM_ROOT, AMstr("tracks"), nullptr);
    if (!tracksResult || AMresultStatus(tracksResult) != AM_STATUS_OK) {
        if (tracksResult) AMresultFree(tracksResult);
        last_error_ = "Failed to get tracks array";
        return false;
    }
    results_to_free.push_back(tracksResult);
    const AMobjId* tracksId = AMitemObjId(AMresultItem(tracksResult));

    // Get track object
    AMresult* trackResult = AMlistGet(doc_, tracksId, trackIdx, nullptr);
    if (!trackResult || AMresultStatus(trackResult) != AM_STATUS_OK) {
        for (auto* r : results_to_free) AMresultFree(r);
        if (trackResult) AMresultFree(trackResult);
        last_error_ = "Failed to get track";
        return false;
    }
    results_to_free.push_back(trackResult);
    const AMobjId* trackObjId = AMitemObjId(AMresultItem(trackResult));

    // Set gain
    AMresult* putResult = AMmapPutF64(doc_, trackObjId, AMstr("gain"), gain);
    if (!checkResult(putResult, "set gain")) {
        for (auto* r : results_to_free) AMresultFree(r);
        return false;
    }
    results_to_free.push_back(putResult);

    // Commit
    AMresult* commitResult = AMcommit(doc_, AMstr("Set track gain"), nullptr);
    if (commitResult) results_to_free.push_back(commitResult);

    // Free all results
    for (auto* r : results_to_free) {
        AMresultFree(r);
    }

    notifyChange();
    return true;
}

bool AutomergeDocument::addTrack(const TrackDef& track) {
    if (!doc_) {
        last_error_ = "No document loaded";
        return false;
    }

    std::vector<AMresult*> results_to_free;

    // Get tracks array
    AMresult* tracksResult = AMmapGet(doc_, AM_ROOT, AMstr("tracks"), nullptr);
    if (!tracksResult || AMresultStatus(tracksResult) != AM_STATUS_OK) {
        if (tracksResult) AMresultFree(tracksResult);
        last_error_ = "Failed to get tracks array";
        return false;
    }
    results_to_free.push_back(tracksResult);
    const AMobjId* tracksId = AMitemObjId(AMresultItem(tracksResult));

    // Add track object at end of list
    size_t trackPos = AMobjSize(doc_, tracksId, nullptr);
    AMresult* trackResult = AMlistPutObject(doc_, tracksId, trackPos, true, AM_OBJ_TYPE_MAP);
    if (!checkResult(trackResult, "add track")) {
        for (auto* r : results_to_free) AMresultFree(r);
        return false;
    }
    results_to_free.push_back(trackResult);
    const AMobjId* trackObjId = AMitemObjId(AMresultItem(trackResult));

    // Write track fields
    AMresult* r;
    r = AMmapPutStr(doc_, trackObjId, AMstr("id"), AMstr(track.id.c_str()));
    if (r) results_to_free.push_back(r);

    r = AMmapPutStr(doc_, trackObjId, AMstr("name"), AMstr(track.name.c_str()));
    if (r) results_to_free.push_back(r);

    r = AMmapPutF64(doc_, trackObjId, AMstr("gain"), track.gain);
    if (r) results_to_free.push_back(r);

    // Create clips array and populate with clips from track
    r = AMmapPutObject(doc_, trackObjId, AMstr("clips"), AM_OBJ_TYPE_LIST);
    if (!r || AMresultStatus(r) != AM_STATUS_OK) {
        if (r) AMresultFree(r);
        for (auto* res : results_to_free) AMresultFree(res);
        last_error_ = "Failed to create clips array";
        return false;
    }
    const AMobjId* clipsId = AMitemObjId(AMresultItem(r));
    results_to_free.push_back(r);

    // Write each clip
    for (size_t i = 0; i < track.clips.size(); ++i) {
        const auto& clip = track.clips[i];

        // Create clip object
        AMresult* clipResult = AMlistPutObject(doc_, clipsId, i, true, AM_OBJ_TYPE_MAP);
        if (!clipResult || AMresultStatus(clipResult) != AM_STATUS_OK) {
            if (clipResult) AMresultFree(clipResult);
            for (auto* res : results_to_free) AMresultFree(res);
            last_error_ = "Failed to create clip object";
            return false;
        }
        const AMobjId* clipObjId = AMitemObjId(AMresultItem(clipResult));
        results_to_free.push_back(clipResult);

        // Write clip fields
        AMresult* cr;
        cr = AMmapPutStr(doc_, clipObjId, AMstr("id"), AMstr(clip.id.c_str()));
        if (cr) results_to_free.push_back(cr);

        cr = AMmapPutStr(doc_, clipObjId, AMstr("assetHash"), AMstr(clip.asset_hash.c_str()));
        if (cr) results_to_free.push_back(cr);

        cr = AMmapPutInt(doc_, clipObjId, AMstr("startSample"), clip.start_sample);
        if (cr) results_to_free.push_back(cr);

        cr = AMmapPutInt(doc_, clipObjId, AMstr("lengthSamples"), clip.length_samples);
        if (cr) results_to_free.push_back(cr);

        cr = AMmapPutInt(doc_, clipObjId, AMstr("offsetSamples"), clip.offset_samples);
        if (cr) results_to_free.push_back(cr);
    }

    // Create chain array (processors - empty for now)
    r = AMmapPutObject(doc_, trackObjId, AMstr("chain"), AM_OBJ_TYPE_LIST);
    if (r) results_to_free.push_back(r);

    // Commit
    r = AMcommit(doc_, AMstr("Add track"), nullptr);
    if (r) results_to_free.push_back(r);

    // Free all results
    for (auto* result : results_to_free) {
        AMresultFree(result);
    }

    notifyChange();
    return true;
}

void AutomergeDocument::notifyChange() {
    if (change_callback_) {
        change_callback_(getDocument());
    }
}

}  // namespace daw::document
