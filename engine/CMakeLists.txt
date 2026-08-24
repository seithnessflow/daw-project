cmake_minimum_required(VERSION 3.20)

# CMP0091: MSVC runtime library flags are selected by CMAKE_MSVC_RUNTIME_LIBRARY
cmake_policy(SET CMP0091 NEW)

# Force dynamic runtime on MSVC BEFORE project() so it applies globally
if(WIN32 OR MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL" CACHE STRING "" FORCE)
endif()

project(daw_engine VERSION 0.1.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# =============================================================================
# Dependencies via FetchContent
# =============================================================================

include(FetchContent)

# miniaudio - single header audio library
FetchContent_Declare(
    miniaudio
    GIT_REPOSITORY https://github.com/mackron/miniaudio.git
    GIT_TAG 0.11.21
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(miniaudio)

# dr_libs - single header libraries (dr_wav)
FetchContent_Declare(
    dr_libs
    GIT_REPOSITORY https://github.com/mackron/dr_libs.git
    GIT_TAG master
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(dr_libs)

# IXWebSocket - modern C++ WebSocket library
FetchContent_Declare(
    ixwebsocket
    GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
    GIT_TAG v11.4.4
    GIT_SHALLOW TRUE
)
set(USE_TLS OFF CACHE BOOL "" FORCE)
set(USE_ZLIB OFF CACHE BOOL "" FORCE)
set(USE_OPEN_SSL OFF CACHE BOOL "" FORCE)
set(IXWEBSOCKET_INSTALL OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(ixwebsocket)

# Protobuf
FetchContent_Declare(
    protobuf
    GIT_REPOSITORY https://github.com/protocolbuffers/protobuf.git
    GIT_TAG v25.1
    GIT_SHALLOW TRUE
)
set(protobuf_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(protobuf_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(protobuf_INSTALL OFF CACHE BOOL "" FORCE)
# Force dynamic runtime on MSVC (protobuf + abseil)
set(protobuf_MSVC_STATIC_RUNTIME OFF CACHE BOOL "" FORCE)
set(ABSL_MSVC_STATIC_RUNTIME OFF CACHE BOOL "" FORCE)
set(ABSL_PROPAGATE_CXX_STD ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(protobuf)

# =============================================================================
# Automerge-C (from monorepo, pre-built)
# =============================================================================

# automerge-c is part of the automerge monorepo at rust/automerge-c/
# The monorepo checkout lives OUTSIDE any build tree (third_party/) so that
# deleting build directories never breaks the toolchain.
# Linux: third_party/automerge/rust/automerge-c/build/libautomerge.a
# Windows: third_party/automerge/rust/target/x86_64-pc-windows-msvc/release/automerge_core.lib
# Override with -DAUTOMERGE_MONOREPO_DIR=<path> if needed.

if(NOT DEFINED AUTOMERGE_MONOREPO_DIR)
    set(AUTOMERGE_MONOREPO_DIR "${CMAKE_SOURCE_DIR}/../third_party/automerge")
endif()
set(AUTOMERGE_C_DIR "${AUTOMERGE_MONOREPO_DIR}/rust/automerge-c")

if(WIN32)
    # Windows MSVC: use Cargo output directly
    set(AUTOMERGE_LIB_PATH "${AUTOMERGE_MONOREPO_DIR}/rust/target/x86_64-pc-windows-msvc/release/automerge_core.lib")
    set(AUTOMERGE_BUILD_DIR "${AUTOMERGE_C_DIR}/build")  # For headers
else()
    # Linux/macOS: use CMake build
    set(AUTOMERGE_BUILD_DIR "${AUTOMERGE_C_DIR}/build")
    set(AUTOMERGE_LIB_PATH "${AUTOMERGE_BUILD_DIR}/libautomerge.a")
endif()

# Verify the library exists
if(NOT EXISTS "${AUTOMERGE_LIB_PATH}")
    if(WIN32)
        message(FATAL_ERROR
            "automerge-c not found at ${AUTOMERGE_LIB_PATH}\n"
            "Build it first:\n"
            "  cd ${AUTOMERGE_C_DIR}\n"
            "  cargo build --release --target x86_64-pc-windows-msvc -p automerge-c"
        )
    else()
        message(FATAL_ERROR
            "automerge-c not found at ${AUTOMERGE_LIB_PATH}\n"
            "Build it first:\n"
            "  cd ${AUTOMERGE_C_DIR}\n"
            "  cmake -B build -DBUILD_TESTING=OFF\n"
            "  cmake --build build"
        )
    endif()
endif()

message(STATUS "Found automerge-c: ${AUTOMERGE_LIB_PATH}")

# Create imported library
add_library(automerge_c STATIC IMPORTED GLOBAL)
set_target_properties(automerge_c PROPERTIES
    IMPORTED_LOCATION "${AUTOMERGE_LIB_PATH}"
)

# Include directories for automerge-c headers
set(AUTOMERGE_INCLUDE_DIRS
    "${AUTOMERGE_C_DIR}/include"
    "${AUTOMERGE_BUILD_DIR}/include"
)

# =============================================================================
# Header-only library targets
# =============================================================================

add_library(miniaudio INTERFACE)
target_include_directories(miniaudio INTERFACE ${miniaudio_SOURCE_DIR})

add_library(dr_libs INTERFACE)
target_include_directories(dr_libs INTERFACE ${dr_libs_SOURCE_DIR})


# =============================================================================
# Protocol Buffers Compilation
# =============================================================================

set(PROTO_FILES
    ${CMAKE_CURRENT_SOURCE_DIR}/src/protocol/messages.proto
    ${CMAKE_CURRENT_SOURCE_DIR}/src/protocol/host_messages.proto
)

set(PROTO_OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated)
file(MAKE_DIRECTORY ${PROTO_OUTPUT_DIR})

# Generate C++ from proto files
add_custom_command(
    OUTPUT
        ${PROTO_OUTPUT_DIR}/messages.pb.h
        ${PROTO_OUTPUT_DIR}/messages.pb.cc
        ${PROTO_OUTPUT_DIR}/host_messages.pb.h
        ${PROTO_OUTPUT_DIR}/host_messages.pb.cc
    COMMAND protobuf::protoc
        --proto_path=${CMAKE_CURRENT_SOURCE_DIR}/src/protocol
        --cpp_out=${PROTO_OUTPUT_DIR}
        ${PROTO_FILES}
    DEPENDS ${PROTO_FILES} protobuf::protoc
    COMMENT "Generating Protocol Buffer sources"
)

# Library for generated protobuf code
add_library(daw_protocol STATIC
    ${PROTO_OUTPUT_DIR}/messages.pb.cc
    ${PROTO_OUTPUT_DIR}/host_messages.pb.cc
)
target_include_directories(daw_protocol PUBLIC ${PROTO_OUTPUT_DIR})
target_link_libraries(daw_protocol PUBLIC protobuf::libprotobuf)

# =============================================================================
# Engine Library
# =============================================================================

add_library(daw_engine_lib STATIC
    src/audio/ring_buffer.h
    src/audio/audio_callback.h
    src/audio/audio_callback.cpp
    src/audio/audio_device.h
    src/audio/audio_device.cpp
    src/graph/processor_node.h
    src/graph/gain_node.h
    src/graph/gain_node.cpp
    src/graph/clip_player.h
    src/graph/clip_player.cpp
    src/graph/audio_graph.h
    src/graph/audio_graph.cpp
    src/graph/graph_common.h
    src/graph/graph_common.cpp
    src/document/schema.h
    src/document/schema.cpp
    src/document/automerge_document.h
    src/document/automerge_document.cpp
    src/transport/transport_state.h
    src/transport/transport_state.cpp
    src/render/offline_render.h
    src/render/offline_render.cpp
    src/render/stem_render.h
    src/render/stem_render.cpp
    src/util/crash_handler.h
    src/util/crash_handler.cpp
    src/network/server_client.h
    src/network/server_client.cpp
    src/websocket/websocket_server.h
    src/websocket/websocket_server.cpp
    src/host/shared_audio_ring.h
    src/host/plugin_bridge.h
    src/host/plugin_bridge.cpp
    src/host/plugin_scan.h
    src/host/plugin_scan.cpp
    src/host/proxy_node.h
    src/host/proxy_node.cpp
    src/host/sync_proxy_node.h
    src/host/sync_proxy_node.cpp
    src/util/sha256.h
    src/util/sha256.cpp
)

target_include_directories(daw_engine_lib PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${AUTOMERGE_INCLUDE_DIRS}
)

target_link_libraries(daw_engine_lib PUBLIC
    miniaudio
    dr_libs
    automerge_c
    ixwebsocket
    daw_protocol
)

# Platform-specific
if(WIN32)
    # Windows: link system libraries
    target_link_libraries(daw_engine_lib PUBLIC
        ws2_32      # Winsock2 (IXWebSocket)
        wsock32     # Winsock
        dbghelp     # crash handler: symbolisation au crash (PDB a cote)
        userenv     # Rust runtime
        bcrypt      # Rust crypto
        ntdll       # Rust runtime
    )
    # Disable specific MSVC warnings for third-party code
    target_compile_options(daw_engine_lib PRIVATE /W3)
elseif(UNIX AND NOT APPLE)
    find_package(Threads REQUIRED)
    target_link_libraries(daw_engine_lib PUBLIC
        Threads::Threads
        dl
        m
    )
endif()

# =============================================================================
# Engine Executable
# =============================================================================

add_executable(daw_engine
    src/main.cpp
)

target_link_libraries(daw_engine PRIVATE daw_engine_lib)

# =============================================================================
# Tests
# =============================================================================

add_executable(daw_engine_test
    tests/cli_integration_test.cpp
)
target_link_libraries(daw_engine_test PRIVATE daw_engine_lib)

add_executable(create_test_doc
    tests/create_test_doc.cpp
)
target_link_libraries(create_test_doc PRIVATE daw_engine_lib)

# =============================================================================
# VST3 SDK + plugin host (ADR-017, 2.4a) - lives in its own file because the
# CI cache of the SDK build tree is keyed on ITS hash, not on this file's:
# see engine/cmake/vst3sdk.cmake.
# =============================================================================

include(cmake/vst3sdk.cmake)
