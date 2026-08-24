---
name: cdx-studio-remote-gpu
description: Run CDX Studio's UI on one machine and its ComfyUI generation on another, given the app's loopback-only rule. Use when ComfyUI is unreachable, when setting up CDX Studio on a machine with no NVIDIA GPU, when generations should run on a remote/shared GPU box, or when project media must be shared between machines.
tools: Read, Bash, Grep
---

# Running the GPU on another machine

CDX Studio refuses any ComfyUI host that is not loopback. `src/services/localComfyConnection.js`
rejects a remote host outright:

> Remote ComfyUI is disabled. Use localhost/127.0.0.1 only.

This is an inherited safety default and a good one. **Do not patch it out.** The supported way to
use a remote GPU is to make the remote endpoint *appear* local.

## The pattern

Forward the remote ComfyUI port onto loopback on the machine running the UI:

```bash
ssh -N -L 127.0.0.1:8188:127.0.0.1:8188 your-gpu-host
```

The app now sees an ordinary local ComfyUI on `127.0.0.1:8188`, stays completely stock, and every
generation executes on the remote GPU. The client machine needs no NVIDIA hardware at all.

Make it durable with a user service rather than a terminal you might close:

```ini
# ~/.config/systemd/user/comfy-tunnel.service
[Unit]
Description=Forward remote ComfyUI onto loopback
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
ExecStart=/usr/bin/ssh -N \
  -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:8188:127.0.0.1:8188 your-gpu-host
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

`systemctl --user enable --now comfy-tunnel` — and `loginctl enable-linger $USER` so it survives a
reboot without a login session.

## Verify you got the right GPU

Do not assume the tunnel is live. Ask the endpoint what hardware it is:

```bash
curl -s http://127.0.0.1:8188/system_stats \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["devices"][0]["name"])'
```

If that names the remote GPU, generation is landing on the remote box. If it errors, the tunnel is
down and generation will fail — say so rather than queueing work into a dead endpoint.

## Sharing the project folder

Generation writes output where ComfyUI runs. If the project folder lives on the GPU host, mount it
on the client at the **same absolute path**:

```bash
sshfs -o reconnect,auto_cache,entry_timeout=5,attr_timeout=5 \
  gpu-host:/home/you/Projects /home/you/Projects
```

**Path parity is the point.** Projects record absolute paths; mounting at a matching path makes them
resolve identically on both machines, and output written on the GPU host appears in the project with
no copy step. Mount it somewhere else and every recorded path breaks.

Keep the caches short rather than using `kernel_cache` — a stale cache means freshly generated
output does not show up, which reads as a failed generation when it actually succeeded.

## Other services

The same trick applies to any loopback-only dependency the app expects — a motion service, a
directory API. Forward each onto the same local port it would occupy natively, and the app cannot
tell the difference.

## When it breaks

1. `curl` the endpoint. No answer → the tunnel is down.
2. `systemctl --user status` the tunnel service.
3. Check whether something else already holds the port — a local ComfyUI, or another forwarder. Two
   owners of `:8188` is a common and confusing failure.
4. Confirm the remote service is actually listening on the far side.
