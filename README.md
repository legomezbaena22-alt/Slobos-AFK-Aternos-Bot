# Slobos AFK Aternos Bot — Minecraft Java 26.3

This revision updates the bot's Mineflayer stack for **Minecraft Java Edition 26.3 (protocol 777)**. It is intended for Java servers, including Java servers that allow Bedrock players through a bridge such as Geyser/Floodgate.

## Important: Java + Bedrock crossplay

Mineflayer is a **Java Edition** bot. That is compatible with a Java server that offers Bedrock crossplay: Bedrock players enter through Geyser, while this bot connects directly to the server's **Java address and Java port**. Do not use the Bedrock/Geyser UDP port for this bot.

## Changes in this revision

- Replaced upstream Mineflayer with `@wp2508/mineflayer` 4.42.7, which advertises support for 26.3.
- Replaced `minecraft-data` with `@wp2508/minecraft-data` 3.111.7.
- Pinned the configured server protocol to `26.3` rather than relying on auto-detection.
- Moved the auto-auth password to the Railway environment variable `MC_AUTH_PASSWORD`; the settings file no longer contains the previous plaintext password.
- Removed the old `package-lock.json` so the deployment can resolve a lockfile consistent with these package changes. Railway should run `npm install` during deployment.

## Configure

1. Check `settings.json` and confirm `server.ip` and `server.port` are the Java connection address and port shown by Aternos.
2. Keep `server.version` set to `26.3`.
3. In Railway → service → Variables, add `MC_AUTH_PASSWORD` only if your server uses `/login` or `/register`. Leave it unset if the server does not require an in-game password.
4. Deploy from GitHub. The start command remains `npm start`.
5. Check Deploy Logs. The startup should show `Using Minecraft Java protocol version 26.3`.

## Compatibility note

This uses a third-party Mineflayer fork that advertises 26.3 support. It is not an official upstream Mineflayer release. Protocol support is necessary but does not guarantee compatibility with every server fork, plugin, proxy, or anti-cheat. Test the bot after deployment and inspect the first disconnect reason if it still fails.

## Server software

The current repository does not identify your Aternos server software. This bot should connect to a Java Edition server endpoint regardless of whether the server implementation is Paper, Fabric, Purpur, or another Java server, provided its protocol and authentication mode are compatible. The Bedrock crossplay layer does not turn Mineflayer into a Bedrock client.

## Security

Do not commit server passwords, Microsoft credentials, or webhook URLs to GitHub. Use Railway Variables for secrets. If the old auto-auth password was real and the repository was public, change it on the Minecraft server.
