# NetMap

Desktop app that scans your local network and the path to the internet.

- 🛰️ **Path to the internet**: every hop, latency, loss, ASN, VPN detection
- 🗺️ **Network map**: zoomable map of all devices around the gateway
- 📋 **Devices**: open ports, services, vendor, OS, model, with the evidence
  behind each guess
- 🔍 **Deep scan**: all 65,535 ports of one device

No root needed. Results stay on your machine.

![NetMap: network map with device details (demo data)](docs/screenshot.png)

## Requirements

Linux, with `ping`, `ip`, `curl` and `mtr`. Optional, for more device names:
`dig`, `avahi-browse`, `nmblookup`.

```sh
sudo apt install iputils-ping iproute2 curl mtr-tiny dnsutils avahi-utils samba-common-bin
```

## Run

One command: clones, installs what is missing, builds, installs to the app menu,
starts it:

```sh
curl -fsSL https://raw.githubusercontent.com/riagentic/aio/main/run.sh | sh -s riagentic/netmap
```

Or download the AppImage from Releases, then:

```sh
chmod +x netmap-*.AppImage && ./netmap-*.AppImage
```

## Develop

Built with [aio](https://github.com/riagentic/aio). Install `am`, then:

```sh
am fix              # link the framework, install deps
deno task dev       # run
deno task test      # test
deno task compile   # build the AppImage into dist/
```

Demo mode scans a made-up network (no probes): `NETMAP_DEMO=1 deno task dev`.

## Privacy

The scan runs locally. Only two outside requests: `ipinfo.io` (your public IP
and provider) and `standards-oui.ieee.org` (vendor list, once a month).

## License

[MIT](LICENSE)
