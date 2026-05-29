"""
DIMASE ECOSYSTEM CONTROLLER
Full control: BuyVM server (SSH), Docker, local machine, all services.
"""
import subprocess
import json
import os
import psutil
import platform
import requests
import threading
from datetime import datetime

SSH_ALIAS = "buyvm"
SSH_KEY = os.path.expanduser("~/Desktop/oci_key")
SERVER_IP = "209.141.36.104"
MONITOR_URL = "https://monitor.dimaseinc.org/health"

SERVICES = {
    "dimaseinc.org": "https://dimaseinc.org",
    "home.dimaseinc.org": "https://home.dimaseinc.org",
    "dtradingpost.dimaseinc.org": "https://dtradingpost.dimaseinc.org",
    "locksmith.dimaseinc.org": "https://locksmith.dimaseinc.org",
    "monitor.dimaseinc.org": "https://monitor.dimaseinc.org/health",
    "files.dimaseinc.org": "https://files.dimaseinc.org",
    "portainer.dimaseinc.org": "https://portainer.dimaseinc.org",
    "grafana.dimaseinc.org": "https://neo-grafana.dimaseinc.org",
    "ann-bibliotheca":       "https://dimaseinc.org/ann-reads",
}

DOCKER_CONTAINERS = [
    "dimase-nexus", "dimase-hud", "map-server", "file-browser",
    "portainer", "neo-grafana", "neo-prometheus", "neo-loki", "nginx-proxy"
]


class EcosystemController:
    def __init__(self):
        self._server_cache = None
        self._server_cache_time = 0
        self._lock = threading.Lock()

    def ssh_exec(self, command: str, timeout: int = 30) -> dict:
        """Execute command on BuyVM server via SSH."""
        try:
            result = subprocess.run(
                ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
                 "-o", "ConnectTimeout=10", f"root@{SERVER_IP}", command],
                capture_output=True, text=True, timeout=timeout
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "success": result.returncode == 0,
            }
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": "SSH command timed out", "returncode": -1, "success": False}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "returncode": -1, "success": False}

    def local_exec(self, command: str, timeout: int = 30) -> dict:
        """Execute command on local machine."""
        try:
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True,
                timeout=timeout, cwd=os.path.expanduser("~")
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "success": result.returncode == 0,
            }
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": "Command timed out", "returncode": -1, "success": False}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "returncode": -1, "success": False}

    def get_server_stats(self, force: bool = False) -> dict:
        """Get server stats from monitor API (cached 30s)."""
        now = datetime.utcnow().timestamp()
        if not force and self._server_cache and (now - self._server_cache_time) < 30:
            return self._server_cache

        try:
            resp = requests.get(MONITOR_URL, timeout=10)
            data = resp.json()
            data["online"] = True
            data["fetched_at"] = datetime.utcnow().isoformat()
            with self._lock:
                self._server_cache = data
                self._server_cache_time = now
            return data
        except Exception as e:
            fallback = {
                "online": False,
                "error": str(e),
                "fetched_at": datetime.utcnow().isoformat()
            }
            return fallback

    def get_local_stats(self) -> dict:
        """Get local machine stats."""
        try:
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            cpu_freq = psutil.cpu_freq()
            return {
                "hostname": platform.node(),
                "os": f"{platform.system()} {platform.release()}",
                "cpu_percent": psutil.cpu_percent(interval=0.5),
                "cpu_count": psutil.cpu_count(),
                "cpu_freq_mhz": round(cpu_freq.current) if cpu_freq else None,
                "memory_total_gb": round(mem.total / 1e9, 1),
                "memory_used_gb": round(mem.used / 1e9, 1),
                "memory_percent": mem.percent,
                "disk_total_gb": round(disk.total / 1e9, 1),
                "disk_used_gb": round(disk.used / 1e9, 1),
                "disk_percent": disk.percent,
                "uptime_seconds": int(datetime.utcnow().timestamp() - psutil.boot_time()),
                "load_avg": list(os.getloadavg()),
                "online": True,
            }
        except Exception as e:
            return {"online": False, "error": str(e)}

    def get_containers(self) -> list:
        """List Docker containers on server."""
        result = self.ssh_exec(
            'docker ps -a --format \'{"name":"{{.Names}}","status":"{{.Status}}","image":"{{.Image}}","ports":"{{.Ports}}","id":"{{.ID}}"}\''
        )
        containers = []
        if result["success"]:
            for line in result["stdout"].strip().split('\n'):
                line = line.strip()
                if line:
                    try:
                        containers.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        return containers

    def container_action(self, name: str, action: str) -> dict:
        """Start/stop/restart a Docker container."""
        if action not in ("start", "stop", "restart", "logs"):
            return {"success": False, "error": "Invalid action"}
        if action == "logs":
            return self.ssh_exec(f"docker logs --tail 50 {name}")
        return self.ssh_exec(f"docker {action} {name}")

    def get_container_logs(self, name: str, lines: int = 50) -> dict:
        return self.ssh_exec(f"docker logs --tail {lines} {name} 2>&1")

    def check_services(self) -> list:
        """Check all service URLs."""
        results = []
        for name, url in SERVICES.items():
            try:
                resp = requests.get(url, timeout=8, allow_redirects=True)
                results.append({
                    "name": name,
                    "url": url,
                    "status": resp.status_code,
                    "online": resp.status_code < 500,
                    "latency_ms": int(resp.elapsed.total_seconds() * 1000),
                })
            except Exception as e:
                results.append({
                    "name": name,
                    "url": url,
                    "status": 0,
                    "online": False,
                    "latency_ms": 0,
                    "error": str(e),
                })
        return results

    def deploy_worker(self, worker_path: str = "/media/Storage/server-flies/dimase_nexus") -> dict:
        """Deploy a CF Worker from server."""
        return self.ssh_exec(f"cd {worker_path} && npx wrangler deploy 2>&1", timeout=120)

    def get_disk_usage(self) -> dict:
        """Get server disk usage."""
        result = self.ssh_exec("df -h / /media/Storage 2>/dev/null | tail -n +2")
        return result

    def read_server_file(self, path: str) -> dict:
        """Read a file from the server."""
        safe_path = path.replace("'", "")
        return self.ssh_exec(f"cat '{safe_path}' 2>&1 | head -c 50000")

    def write_server_file(self, path: str, content: str) -> dict:
        """Write content to a server file."""
        safe_path = path.replace("'", "")
        # Use printf to avoid shell interpretation issues
        content_escaped = content.replace("'", "'\\''")
        return self.ssh_exec(f"printf '%s' '{content_escaped}' > '{safe_path}'")

    def list_server_dir(self, path: str = "/media/Storage") -> dict:
        safe_path = path.replace("'", "")
        return self.ssh_exec(f"ls -la '{safe_path}' 2>&1")

    def get_full_status(self) -> dict:
        """Full ecosystem status report."""
        server_stats = self.get_server_stats()
        local_stats = self.get_local_stats()
        return {
            "server": server_stats,
            "local": local_stats,
            "timestamp": datetime.utcnow().isoformat(),
        }
