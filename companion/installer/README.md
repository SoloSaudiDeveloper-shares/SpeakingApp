# Installer release gate

The MSI is an IT-managed, per-machine installation. A release is acceptable
only when all of the following are attached to the same immutable version:

1. Authenticode signatures for the service executable and MSI.
2. SHA-256 checksums.
3. An SBOM for the self-contained .NET publish output.
4. Malware-scan evidence and a clean dependency audit.
5. A successful install, repair, upgrade, and uninstall test on a clean VM.

The `companion_release_gate` workflow enforces the reproducible build, frozen
worker, signed-model installation, synthesis, and MSI lifecycle checks on a
Windows runner. It uses a short-lived test certificate. Production promotion
must replace that signature with the organization-controlled Authenticode
certificate and retain the clean-VM/malware evidence with the immutable
release.

The service runs as `LocalService`; it must not run as `LocalSystem` or the
interactive user. Model files live under `%ProgramData%\SpeakingLab\Companion`
and are not embedded in the MSI.
