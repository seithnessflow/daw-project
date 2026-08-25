// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file automerge_document.h
 * @brief Real Automerge document wrapper using automerge-c.
 *
 * This wraps the actual automerge-c library to load, save, and manipulate
 * Automerge documents. No JSON fallback.
 */

#include "schema.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include <functional>

// Forward declare automerge-c types
struct AMdoc;
struct AMresult;
struct AMobjId;

namespace daw::document {

/**
 * Callback for document changes.
 */
using DocumentChangeCallback = std::function<void(const ProjectDef&)>;

/**
 * Automerge document wrapper.
 *
 * Uses automerge-c to manage CRDT documents.
 */
class AutomergeDocument {
public:
    AutomergeDocument();
    ~AutomergeDocument();

    // Non-copyable
    AutomergeDocument(const AutomergeDocument&) = delete;
    AutomergeDocument& operator=(const AutomergeDocument&) = delete;

    // Movable
    AutomergeDocument(AutomergeDocument&&) noexcept;
    AutomergeDocument& operator=(AutomergeDocument&&) noexcept;

    /**
     * Create a new empty document.
     *
     * @param sample_rate Project sample rate
     * @return true on success
     */
    bool create(uint32_t sample_rate = 48000);

    /**
     * Load a document from a .am file.
     *
     * @param path Path to .am file
     * @return true on success
     */
    bool loadFromFile(const std::string& path);

    /**
     * Load a document from binary data.
     *
     * @param data Binary document data
     * @param size Size in bytes
     * @return true on success
     */
    bool loadFromBytes(const uint8_t* data, size_t size);

    /**
     * Save the document to a .am file.
     *
     * @param path Path to save to
     * @return true on success
     */
    bool saveToFile(const std::string& path) const;

    /**
     * Get the document as bytes.
     *
     * @return Binary Automerge document
     */
    std::vector<uint8_t> toBytes() const;

    /**
     * Apply an Automerge change/sync message.
     *
     * @param change_data Change binary data
     * @param size Size in bytes
     * @return true on success
     */
    bool applyChange(const uint8_t* change_data, size_t size);

    /**
     * AUDIT-5 A4: merge an incoming FULL document INTO this one instead of
     * replacing it. On (re)connection the server resends the whole doc; a
     * plain load would clobber engine-authored fields (stemHash/stateHash)
     * the server has not yet seen. Merge preserves local changes and
     * integrates remote ones. With no doc loaded yet it adopts (== load).
     */
    bool mergeFromBytes(const uint8_t* data, size_t size);

    /**
     * Generate sync message for peer.
     *
     * @return Sync message bytes, or empty if nothing to sync
     */
    std::vector<uint8_t> generateSyncMessage();

    /**
     * Receive sync message from peer.
     *
     * @param message Sync message bytes
     * @param size Size in bytes
     * @return true on success
     */
    bool receiveSyncMessage(const uint8_t* message, size_t size);

    /**
     * Get the current document definition.
     *
     * Reads the Automerge document and converts to ProjectDef.
     */
    ProjectDef getDocument() const;

    /**
     * V1.2: set the root masterGain (authoring API, addTrack's family -
     * in production the browser owns the document).
     */
    bool setMasterGain(float gain);

    /**
     * 2.5-etat: write a chain node's state reference (stateHash +
     * stateVersion). THE exception to "the browser owns the document":
     * only the machine hosting the plugin can serialize its state, so
     * the ENGINE authors this one field pair.
     */
    bool setProcessorState(const std::string& track_id,
                           const std::string& node_id,
                           const std::string& state_hash,
                           int64_t state_version);

    /**
     * S7: write a chain node's STEM reference (rendered truth in the
     * store). Engine-authored, same family as setProcessorState.
     */
    bool setProcessorStem(const std::string& track_id,
                          const std::string& node_id,
                          const std::string& stem_hash,
                          const std::string& stem_key,
                          int64_t stem_latency_samples);

    /**
     * Bytes of the LAST local change (empty when none) - what the
     * engine ships to the server after authoring. Mirrors the web's
     * getLastLocalChange contract.
     */
    std::vector<uint8_t> getLastLocalChange();

    /**
     * Check if document is loaded.
     */
    bool isLoaded() const { return doc_ != nullptr; }

    /**
     * Get last error message.
     */
    const std::string& getLastError() const { return last_error_; }

    /**
     * Set a callback for document changes.
     */
    void setChangeCallback(DocumentChangeCallback callback) {
        change_callback_ = std::move(callback);
    }

    // --- Mutations ---

    /**
     * Set track gain.
     *
     * @param track_id Track ID
     * @param gain New gain value (0.0 to 2.0)
     * @return true if track found and updated
     */
    bool setTrackGain(const std::string& track_id, float gain);

    /**
     * Add a track to the document.
     *
     * @param track Track definition
     * @return true on success
     */
    bool addTrack(const TrackDef& track);

private:
    /** Shared walk for the engine-authored chain-node writers. */
    bool withChainNode(const std::string& track_id, const std::string& node_id,
                       const std::function<bool(const ::AMobjId*)>& write);

    AMdoc* doc_ = nullptr;
    AMresult* doc_result_ = nullptr;  // Owns the document memory
    std::string last_error_;
    DocumentChangeCallback change_callback_;

    // Sync state for peer sync
    void* sync_state_ = nullptr;

    /**
     * Read the document structure from Automerge into ProjectDef.
     */
    bool readDocument(ProjectDef& out) const;

    /**
     * Write ProjectDef structure to Automerge document.
     */
    bool writeDocument(const ProjectDef& def);

    /**
     * Find track index by ID.
     *
     * @return Track index or -1 if not found
     */
    int findTrackIndex(const std::string& track_id) const;

    /**
     * Free automerge resources.
     */
    void cleanup();

    /**
     * Check AMresult for errors.
     */
    bool checkResult(AMresult* result, const char* context);

    /**
     * Notify change callback.
     */
    void notifyChange();
};

}  // namespace daw::document
