# Proxy Tools · Symantec SWG

A desktop application for managing and troubleshooting **Symantec Secure Web Gateway / ProxySG** appliances from a single interface. It brings together tasks that usually require multiple consoles, commands and files, making it easier to investigate connectivity, policy and traffic issues.

Built with **Tauri 2 and Rust** for native operations, and **Next.js, React and TypeScript** for the interface. Windows is the primary target; Linux is used for development with mocked data.

## Features

- Register proxies, check connectivity and organize appliances with tags.
- Browse policies and analyze **Policy Trace**, correlating transactions through explicit references.
- Analyze access logs with filters, charts and a request timeline.
- Create and browse configuration backups over SSH.
- Interact with appliances through an SSH console with session command history and collapsible output.
- Manage PAC/WPAD file sources and routing rules.
- Check releases and download updates for manual executable replacement.

## Development requirements

- **Git**, **Node.js 22**, **pnpm 10**, and **stable Rust** with Cargo, installed through [rustup](https://rustup.rs/).
- **Windows:** Visual Studio Build Tools with the **Desktop development with C++** workload, Windows SDK, and Microsoft Edge WebView2 Runtime. Use the Rust MSVC toolchain.
- **Linux:** install the system dependencies for your distribution listed in the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

Live connections require network access to the appliance and its management credentials. Policy and log features use the application's management port (`8082`); SSH connections use port `22`.

## Install and run

Once Node.js and Rust are installed:

```bash
npm install --global pnpm@10

git clone https://github.com/Apheiro/Proxy-Tools-SymantecSWG.git
cd Proxy-Tools-SymantecSWG
pnpm install --frozen-lockfile
pnpm tauri dev
```

If the repository is still private, cloning requires authentication with an account that has access.

`pnpm tauri dev` automatically starts the frontend at `http://localhost:3000` and opens the desktop window. The first Rust build may take several minutes.

In **Settings**, configure your credentials and choose **Live** to work with real appliances or **Mocked Data** for development. On Windows, saved Live credentials use Windows Credential Manager; Mocked Data credentials use a separate localStorage entry.

Mocked SSH features require a local SSH server at `127.0.0.1:2222` and the configured dummy CLI. Enabling Mocked Data does not install that server or start the dummy immediately; see the [Backup Manager guide](docs/backup-manager.md#windows-dummy).

To work only on the interface in a browser:

```bash
pnpm dev
```

Native features such as SSH, Windows credential-vault access and Rust file operations require running the application through Tauri.

## Build the Windows executable

Run these commands **on Windows**, with the development requirements installed:

```bash
pnpm install --frozen-lockfile
pnpm tauri build --no-bundle
```

By default, the executable is generated at `src-tauri/target/release/proxytools.exe`. The repository also includes GitHub Actions workflows for manual Windows builds and attaching the EXE to releases; see the [release guide](docs/releases.md).

## Checks and tests

From the project root:

```bash
# TypeScript type checking
pnpm exec tsc --noEmit

# Native Rust tests
cargo test --manifest-path src-tauri/Cargo.toml --lib

# Interface tests: install Chromium once
pnpm exec playwright install chromium
pnpm exec playwright test
```

## Documentation

- [Backup Manager](docs/backup-manager.md)
- [SSH console](docs/ssh-console.md)
- [Connectivity and DNS resolution](docs/native-proxy-networking.md)
- [Downloading updates](docs/app-updates.md)
- [Versioning and releases](docs/releases.md)

Additional guides are available in the application's **Documentation** section.
