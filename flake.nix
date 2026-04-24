{
  description = "rosbag-analyzer-web dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        aubeVersion = "1.0.0";
        aubeSources = {
          "x86_64-linux" = {
            target = "x86_64-unknown-linux-gnu";
            sha256 = "f1ef1fa992eba8fa2b0859bfa772069eab1fe8962b0aed21ab6539904f5b7e26";
          };
          "aarch64-linux" = {
            target = "aarch64-unknown-linux-gnu";
            sha256 = "24cc19db5283b7ae76627c2ccaa77f0cf5be7f7b7c7baab481874936e246836d";
          };
          "aarch64-darwin" = {
            target = "aarch64-apple-darwin";
            sha256 = "6d90e5e35a834a6f8b0c7023526bf615751b29c3b2a046f16739f305c786f856";
          };
        };
        aubeSrc = aubeSources.${system} or (throw "aube: unsupported system ${system}");

        aube = pkgs.stdenv.mkDerivation {
          pname = "aube";
          version = aubeVersion;

          src = pkgs.fetchurl {
            url = "https://github.com/endevco/aube/releases/download/v${aubeVersion}/aube-v${aubeVersion}-${aubeSrc.target}.tar.gz";
            sha256 = aubeSrc.sha256;
          };

          sourceRoot = ".";

          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.autoPatchelfHook
          ];
          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.stdenv.cc.cc.lib
          ];

          installPhase = ''
            runHook preInstall
            install -Dm755 aube -t $out/bin
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "A fast Node.js package manager";
            homepage = "https://aube.en.dev";
            license = licenses.mit;
            mainProgram = "aube";
          };
        };
      in
      {
        packages.aube = aube;

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            aube
          ];

          shellHook = ''
            echo "node $(node --version) / npm $(npm --version) / aube $(aube --version 2>/dev/null || echo '?')"
          '';
        };
      });
}
