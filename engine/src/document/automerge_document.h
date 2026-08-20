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
