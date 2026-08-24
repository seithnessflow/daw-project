# =============================================================================
# VST3 SDK + plugin host (ADR-017, 2.4a)
# Vendored like automerge: third_party/vst3sdk, pinned (v3.8.1_build_84),
# never committed. See docs/cadrage-2.4.md.
#
# This file is the ONLY cmake input that shapes the SDK build: the CI cache
# of the SDK build tree is keyed on the SDK pin + the hash of THIS file, so
# engine-side CMakeLists.txt changes (new sources, new tests) do not evict
# the cache. Anything that changes how the SDK compiles belongs HERE.
# =============================================================================

set(VST3_SDK_DIR "${CMAKE_SOURCE_DIR}/../third_party/vst3sdk")
if(EXISTS "${VST3_SDK_DIR}/CMakeLists.txt")
    # AGain (the test fixture) requires VSTGUI (its CMakeLists returns
    # without it); hosting examples and the plugin-link symlink (admin
    # rights) stay off.
    set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES ON CACHE BOOL "" FORCE)
    set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(SMTG_ENABLE_VSTGUI_SUPPORT ON CACHE BOOL "" FORCE)
    set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)
    set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
    # Session 2 (2026-08-25) : fixtures en FICHIER PLAT sur Windows -
    # le mode bundle creait le dossier <name>.vst3 la ou le linker veut
    # ecrire le fichier (LNK1104 permanent apres tout changement de
    # config). Epingle ICI pour que portable/CI/checkout frais aient le
    # meme layout que les references (VST3\again.vst3).
    set(SMTG_CREATE_BUNDLE_FOR_WINDOWS OFF CACHE BOOL "" FORCE)
    add_subdirectory(${VST3_SDK_DIR} vst3sdk EXCLUDE_FROM_ALL)

    # Module::create's platform implementation is not part of sdk_hosting:
    # the SDK ships it as a source to add to the host target
    if(WIN32)
        set(VST3_MODULE_IMPL ${VST3_SDK_DIR}/public.sdk/source/vst/hosting/module_win32.cpp)
    else()
        set(VST3_MODULE_IMPL ${VST3_SDK_DIR}/public.sdk/source/vst/hosting/module_linux.cpp)
    endif()

    add_executable(plugin_host
        src/host/plugin_host_main.cpp
        ${VST3_MODULE_IMPL}
    )
    target_link_libraries(plugin_host PRIVATE daw_protocol sdk_hosting)
    target_include_directories(plugin_host PRIVATE ${VST3_SDK_DIR})
    # module_win32.cpp expects C++17 semantics (std::filesystem::path
    # u8string -> std::string; C++20 char8_t breaks it). The host has no
    # C++20 need - it is a separate process, not engine code.
    set_target_properties(plugin_host PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)

    # The integration tests spawn plugin_host against the built AGain,
    # and against mda (the first REAL multi-param plugin family)
    target_compile_definitions(daw_engine_test PRIVATE
        DAW_PLUGIN_HOST_EXE="$<TARGET_FILE:plugin_host>"
        DAW_AGAIN_VST3="$<TARGET_FILE:again>"
        DAW_MDA_VST3="$<TARGET_FILE:mda-vst3>"
    )
    add_dependencies(daw_engine_test plugin_host again mda-vst3)

    message(STATUS "VST3 SDK found: plugin_host + AGain fixture enabled")
else()
    message(WARNING "VST3 SDK not found at ${VST3_SDK_DIR} - plugin_host and its tests are disabled (clone: git clone --recursive --depth 1 --branch v3.8.1_build_84 https://github.com/steinbergmedia/vst3sdk.git third_party/vst3sdk)")
endif()
