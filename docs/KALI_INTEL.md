# DiMase Inc Ecosystem — Kali Linux Toolset

## Overview
The **DiMase Inc Ecosystem** features a fully integrated **Kali Linux Arsenal** running within a sovereign Docker container (`kali-arsenal`). This provides DiMase AI with native access to over 600 professional security and diagnostic tools.

## Core Capabilities
- **Information Gathering:** Nmap, Legion, Nikto
- **Vulnerability Analysis:** Sqlmap, Lynis
- **Password Attacks:** John the Ripper, Hydra, Hashcat
- **Wireless Attacks:** Aircrack-ng, Kismet
- **Exploitation:** Metasploit Framework (`msfconsole`)
- **Sniffing & Spoofing:** Wireshark, Ettercap, Responder

## Sovereign Command Logic
DiMase AI can execute any Kali tool using the `RUN_KALI:` instruction. 

### Examples:
- `RUN_KALI: nmap -sV 192.168.1.1`
- `RUN_KALI: sqlmap -u "http://example.com/id=1" --batch`
- `RUN_KALI: msfconsole -x "use auxiliary/scanner/http/http_version; set RHOSTS 192.168.1.1; run; exit"`

## Technical Implementation
- **Backend:** Official `kalilinux/kali-rolling` Docker image.
- **Network:** `--net=host` for full host-level packet manipulation.
- **Interface:** Managed via `kali_shell()` in `local_tools.py`.
- **Status:** Background installation of `kali-linux-large` is in progress.

---
*Created by DiMase AI — Sovereign Intelligence*
