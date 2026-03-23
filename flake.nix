{
  description = "Bosun — personal multi-agent Pi coding environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        devTools = [
          # Runtime
          pkgs.bash
          pkgs.bun
          pkgs.nodejs_22

          # Sandbox
          pkgs.bubblewrap

          # Terminal
          pkgs.tmux

          # Languages
          pkgs.go

          # Development
          pkgs.git
          pkgs.ripgrep
          pkgs.fd
          pkgs.jq
          pkgs.yq-go

          # GPU compute (node-llama-cpp Vulkan build)
          pkgs.vulkan-headers   # vulkan/vulkan.h — needed by FindVulkan.cmake
          pkgs.vulkan-loader    # libvulkan.so    — runtime + link target
          pkgs.shaderc          # glslc shader compiler — needed once to build llama.cpp with Vulkan
        ];

      in {
        devShells.default = pkgs.mkShell {
          name = "bosun-dev";
          buildInputs = devTools;
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"

            # Synthesize VULKAN_SDK for CMake's FindVulkan.cmake
            # Nix splits headers and libs into separate store paths, but
            # FindVulkan expects $VULKAN_SDK/{include,lib} in one prefix.
            export VULKAN_SDK="$PWD/.vulkan-sdk"
            mkdir -p "$VULKAN_SDK"
            ln -sfn "${pkgs.vulkan-headers}/include" "$VULKAN_SDK/include"
            ln -sfn "${pkgs.vulkan-loader}/lib"      "$VULKAN_SDK/lib"

            echo "Bosun Dev Environment"
            echo "  just start           — start bosun (sandboxed)"
            echo "  just start-unsandboxed — start without bwrap"
            echo "  just doctor          — check tools"
            echo "  just onboard         — first-time setup"
          '';
        };
      }
    );
}
