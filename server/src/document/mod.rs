// SPDX-License-Identifier: GPL-3.0-or-later
//! Document storage and Automerge handling.

mod file_store;
mod project_store;

pub use file_store::FileStore;
pub use project_store::ProjectStore;

/// A4-3: the deterministic SEED document (2 default tracks), byte-
/// identical to the web placeholder (web/src/document/seed.ts) -
/// generated ONCE by web/scripts/make-seed.mjs. A new project starts
/// from these bytes so that edits a client made BEFORE first contact
/// share the same root and merge instead of being wiped.
/// NEVER regenerate casually: new bytes = a new root = that conflict.
pub const SEED_DOC: &[u8] = include_bytes!("seed.am");
