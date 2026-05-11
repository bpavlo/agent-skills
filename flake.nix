{
  description = "Personal skills for AI coding agents (Claude Code, opencode)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        oc-context = pkgs.stdenvNoCC.mkDerivation {
          pname = "oc-context";
          version = "0.1.0";
          src = ./oc-context/scripts;

          dontUnpack = false;
          dontBuild = true;

          nativeBuildInputs = [ pkgs.makeWrapper ];
          buildInputs = [ pkgs.python3 ];

          installPhase = ''
            runHook preInstall
            install -Dm755 oc-context $out/bin/oc-context
            patchShebangs $out/bin/oc-context
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Surface prior opencode sessions as context for AI agents";
            homepage = "https://github.com/bpavlo/agent-skills";
            license = licenses.mit;
            mainProgram = "oc-context";
            platforms = platforms.unix;
          };
        };
      in
      {
        packages = {
          inherit oc-context;
          default = oc-context;
        };

        apps.oc-context = {
          type = "app";
          program = "${oc-context}/bin/oc-context";
        };
      }
    );
}
