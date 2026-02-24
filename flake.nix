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
        ];

      in {
        devShells.default = pkgs.mkShell {
          name = "bosun-dev";
          buildInputs = devTools;
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"

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
