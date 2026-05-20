### README for proxy.js - SafeGuardian API wrapper
tl;dr: I'm running `node proxy.js` on my Raspberry Pi at home, and using Cloudflare Tunnel so that it's accessible at [api.andewmole.com/cat1](https://api.andewmole.com/cat1).

This proxy is necessary due to CORS Access-Control-Allow-Origin on SafeGuardian side.

Setup:
```bash
sudo nano /etc/systemd/system/cat1proxy.service
```
```ini
[Unit]
Description=CAT 1 Node.js CORS Proxy
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/Desktop/cat1
ExecStart=/usr/bin/node /home/pi/Desktop/cat1/proxy.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable cat1proxy.service
sudo systemctl start cat1proxy.service
sudo systemctl status cat1proxy.service
```
```bash
sudo systemctl restart cat1proxy.service
sudo systemctl status cat1proxy.service
```
After signing up and setting up Cloudflare:
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb
cloudflared tunnel login
cloudflared tunnel create proxy-tunnel
cloudflared tunnel route dns proxy-tunnel api.andewmole.com
nano ~/.cloudflared/config.yml
```
```yaml
tunnel: [UUID]
credentials-file: /home/pi/.cloudflared/[UUID].json

ingress:
  - hostname: api.andewmole.com
    path: /cat1/*
    service: http://localhost:3000
  - service: http_status:404
```
```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```
