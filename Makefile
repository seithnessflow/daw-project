# DAW Project Makefile
#
# Usage:
#   make dev      - Build all components and run
#   make engine   - Build engine only
#   make server   - Build server only
#   make web      - Build web client only
#   make fixtures - Generate test fixtures
#   make test     - Run all tests
#   make clean    - Clean build artifacts

.PHONY: all dev engine server web fixtures test clean help

# Directories
ENGINE_DIR := engine
SERVER_DIR := server
WEB_DIR := web
FIXTURES_DIR := fixtures
BUILD_DIR := build

# Default target
all: engine server web

# Development mode: build everything and run
dev: all fixtures
	@echo "Starting development environment..."
	@echo "Run these in separate terminals:"
	@echo "  1. $(BUILD_DIR)/engine/daw_engine --doc fixtures/two-tracks.json --play"
	@echo "  2. cd $(SERVER_DIR) && cargo run"
	@echo "  3. cd $(WEB_DIR) && npm run dev"

# Build engine
engine: $(BUILD_DIR)/engine/daw_engine

$(BUILD_DIR)/engine/daw_engine: $(ENGINE_DIR)/CMakeLists.txt $(shell find $(ENGINE_DIR)/src -name '*.cpp' -o -name '*.h' 2>/dev/null)
	@echo "Building engine..."
	@mkdir -p $(BUILD_DIR)/engine
	@cd $(BUILD_DIR)/engine && cmake ../../$(ENGINE_DIR) -DCMAKE_BUILD_TYPE=Release
	@cd $(BUILD_DIR)/engine && cmake --build . -j$$(nproc 2>/dev/null || echo 4)

# Build server
server: $(SERVER_DIR)/Cargo.toml
	@echo "Building server..."
	@cd $(SERVER_DIR) && cargo build --release

# Build web client
web: $(WEB_DIR)/package.json
	@echo "Building web client..."
	@cd $(WEB_DIR) && npm install && npm run build

# Generate fixtures
fixtures: $(FIXTURES_DIR)/two-tracks.json

$(FIXTURES_DIR)/two-tracks.json: $(FIXTURES_DIR)/generator/create_fixtures.ts
	@echo "Generating fixtures..."
	@cd $(FIXTURES_DIR)/generator && npm install && npm run generate

# Run tests
test: engine fixtures
	@echo "Running tests..."
	@$(BUILD_DIR)/engine/daw_engine_test $(FIXTURES_DIR)
	@echo ""
	@echo "Testing render determinism..."
	@$(BUILD_DIR)/engine/daw_engine --doc $(FIXTURES_DIR)/simple-project.json --render /tmp/test1.wav --assets $(FIXTURES_DIR)
	@$(BUILD_DIR)/engine/daw_engine --doc $(FIXTURES_DIR)/simple-project.json --render /tmp/test2.wav --assets $(FIXTURES_DIR)
	@if cmp -s /tmp/test1.wav /tmp/test2.wav; then \
		echo "✓ Render determinism: PASSED"; \
	else \
		echo "✗ Render determinism: FAILED"; \
		exit 1; \
	fi
	@rm -f /tmp/test1.wav /tmp/test2.wav

# Clean
clean:
	@echo "Cleaning..."
	@rm -rf $(BUILD_DIR)
	@cd $(SERVER_DIR) 2>/dev/null && cargo clean || true
	@rm -rf $(WEB_DIR)/node_modules $(WEB_DIR)/dist 2>/dev/null || true
	@rm -rf $(FIXTURES_DIR)/generator/node_modules 2>/dev/null || true
	@rm -f $(FIXTURES_DIR)/*.wav $(FIXTURES_DIR)/*.json 2>/dev/null || true

# Help
help:
	@echo "DAW Project Build System"
	@echo ""
	@echo "Targets:"
	@echo "  make dev      - Build all and show run instructions"
	@echo "  make engine   - Build C++ engine"
	@echo "  make server   - Build Rust server"
	@echo "  make web      - Build TypeScript web client"
	@echo "  make fixtures - Generate test fixtures"
	@echo "  make test     - Run integration tests"
	@echo "  make clean    - Remove build artifacts"
	@echo ""
	@echo "Requirements:"
	@echo "  - CMake 3.20+"
	@echo "  - C++20 compiler (GCC 10+, Clang 12+)"
	@echo "  - Rust toolchain (for server and automerge-c)"
	@echo "  - Node.js 18+ (for web client and fixtures)"
	@echo "  - Protobuf compiler (protoc)"
