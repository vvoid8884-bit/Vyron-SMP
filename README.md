# 2 Nova ERLC Designs

A Discord.js starter bot for the server commands discussed in chat.

## Requirements

- Node.js 20 or newer
- A Discord application and bot created in the [Discord Developer Portal](https://discord.com/developers/applications)
- The bot invited with `bot` and `applications.commands` scopes. Enable **Server Members Intent** for welcome messages and **Message Content Intent** for `!lock`, `!unlock`, and `!clear`.

## Setup

1. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`.
2. Run `npm install`.
3. Run `npm run deploy` to register the slash commands in your server.
4. Run `npm start` to start the bot.

Never share or commit your bot token. If it is exposed, reset it in the Developer Portal.

## Configuration

- `ROLE_PANEL_ROLE_IDS`: comma-separated role IDs (up to five) shown by `/rolepanel`.
- Edit the `PANEL_TEXT` values in `src/index.js` to set your actual server information, rules, and welcome text before posting panels.

The bot needs permission to view channels, send messages, manage channels, and manage messages for the matching features. It automatically creates a `Verified` role the first time someone uses the verification panel if that role does not already exist. Give the bot **Manage Roles** permission and place its role above `Verified`. The bot creates a private `Tickets` category the first time someone opens a ticket and reuses it for future tickets. Ticket visibility is automatically granted to roles with **Manage Channels** or **Administrator** permissions.

## Commands

Prefix commands: `!lock` prevents members from sending messages in the current channel, `!unlock` allows messaging again, and `!clear` deletes all messages in the current channel. Users need **Manage Channels** for lock/unlock and **Manage Messages** for clear. Discord only allows bulk deletion for messages newer than 14 days, so `!clear` deletes older messages individually.

Ticket controls include **Close**, **Close With Reason**, **Claim**, and **Rename**. Claiming is restricted to staff with **Manage Channels** or **Administrator** permission. The ticket opener or staff can rename the ticket. A close reason is posted in the ticket before it is deleted. Ticket owners, claims, category IDs, and giveaway entries/settings are saved in `data/state.json`; keep that folder if you want to retain state across restarts. The ticket panel offers General Support, Apply For Staff, Appeal For In-Game Unban, Report A Staff Member, Feedback On A Staff Member, and Other. The bot also includes giveaway start/end/reroll, the information and server panels, ticket-role management, verification, and welcome-message controls.

This is a starter configuration: replace the sample panel text with your real server copy. `/rolepanel` still needs `ROLE_PANEL_ROLE_IDS` set to the role IDs you want to offer as self-assignable roles.
