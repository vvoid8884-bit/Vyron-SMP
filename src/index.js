require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const MESSAGE_BULK_DELETE_MAX_AGE = 14 * 24 * 60 * 60 * 1000 - 60_000;

const PANEL_TEXT = {
  infopanel: "Welcome! Update this panel in src/index.js with your server information.",
  paidpanel: "Update this panel with your paid advertisement information and terms.",
  partnershippanel: "Update this panel with your partnership requirements and application instructions.",
  rules: "Add your server rules here before posting this panel.",
  welcomepanel: "Welcome to the server! Please read the rules and verify to get started.",
};

const TICKET_TYPES = [
  { label: "General Support", value: "general-support", description: "Questions or help with the server." },
  { label: "Apply For Staff", value: "staff-application", description: "Open a private ticket about applying for a staff position." },
  { label: "Appeal For In-Game Unban", value: "unban-appeal", description: "Appeal an in-game ban." },
  { label: "Report A Staff Member", value: "staff-report", description: "Privately report a staff member." },
  { label: "Feedback On A Staff Member", value: "staff-feedback", description: "Share feedback about a staff member." },
  { label: "Other", value: "other", description: "Anything else." },
];

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { giveaways: {}, ticketRoles: {}, welcomeEnabled: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${STATE_PATH}: ${error.message}`);
  }
}

const state = loadState();
state.ticketClaims = state.ticketClaims || {};
state.ticketCategories = state.ticketCategories || {};
state.ticketOwners = state.ticketOwners || {};

function saveState() {
  const temporaryPath = `${STATE_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, STATE_PATH);
}

async function getVerifiedRole(guild) {
  const existingRole = guild.roles.cache.find((role) => role.name.toLowerCase() === "verified");
  if (existingRole) return existingRole;

  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Give the bot the Manage Roles permission so it can create the Verified role.");
  }

  return guild.roles.create({
    name: "Verified",
    reason: "Created automatically for the verification panel",
  });
}

async function getTicketCategory(guild, supportRoles) {
  const savedCategoryId = state.ticketCategories[guild.id];
  if (savedCategoryId) {
    const savedCategory = await guild.channels.fetch(savedCategoryId).catch(() => null);
    if (savedCategory?.type === ChannelType.GuildCategory) return savedCategory;
  }

  const category = await guild.channels.create({
    name: "Tickets",
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      ...supportRoles.map((role) => ({
        id: role.id,
        allow: [PermissionFlagsBits.ViewChannel],
      })),
    ],
    reason: "Created automatically to organize private support tickets",
  });
  state.ticketCategories[guild.id] = category.id;
  saveState();
  return category;
}

function parseDuration(input) {
  const match = /^(\d+)(m|h|d)$/i.exec(input.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const milliseconds = amount * ({ m: 60_000, h: 3_600_000, d: 86_400_000 })[unit];
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return null;
  return milliseconds;
}

function giveawayEmbed(giveaway) {
  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${giveaway.prize}`)
    .setDescription(
      giveaway.ended
        ? `Giveaway ended.\nWinners: ${giveaway.winnerIds.length ? giveaway.winnerIds.map((id) => `<@${id}>`).join(", ") : "No eligible entrants."}`
        : `Click the button below to enter!\nEnds <t:${Math.floor(giveaway.endsAt / 1000)}:R>`
    )
    .addFields(
      { name: "Winners", value: String(giveaway.winnerCount), inline: true },
      { name: "Entries", value: String(giveaway.entrants.length), inline: true }
    )
    .setColor(giveaway.ended ? 0x747f8d : 0x5865f2);
  return embed;
}

function entryRow(messageId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${messageId}`)
      .setLabel("Enter Giveaway")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

function ticketControlRow(claimed = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:close")
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ticket:close-reason")
      .setLabel("Close With Reason")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ticket:claim")
      .setLabel(claimed ? "Claimed" : "Claim")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success)
      .setDisabled(claimed),
    new ButtonBuilder()
      .setCustomId("ticket:rename")
      .setLabel("Rename")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function finishGiveaway(client, messageId, reroll = false) {
  const giveaway = state.giveaways[messageId];
  if (!giveaway) throw new Error("I couldn't find that giveaway.");
  if (giveaway.ended && !reroll) throw new Error("That giveaway has already ended.");
  if (reroll && !giveaway.ended) throw new Error("You can only reroll a giveaway after it has ended.");

  const previousWinners = new Set(giveaway.winnerIds || []);
  const eligible = giveaway.entrants.filter((id) => !previousWinners.has(id));
  const winners = [];
  const count = reroll ? Math.min(1, eligible.length) : Math.min(giveaway.winnerCount, eligible.length);
  while (winners.length < count) {
    const index = Math.floor(Math.random() * eligible.length);
    winners.push(eligible.splice(index, 1)[0]);
  }

  if (!reroll) {
    giveaway.ended = true;
    giveaway.winnerIds = winners;
  } else {
    giveaway.winnerIds = [...previousWinners, ...winners];
  }
  saveState();

  const channel = await client.channels.fetch(giveaway.channelId);
  if (!channel || !channel.isTextBased()) throw new Error("The giveaway channel is unavailable.");
  const message = await channel.messages.fetch(messageId);
  await message.edit({
    embeds: [giveawayEmbed(giveaway)],
    components: [entryRow(messageId, giveaway.ended)],
  });
  const winnerText = winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "No eligible entrants.";
  await channel.send(
    reroll
      ? `Replacement winner for **${giveaway.prize}**: ${winnerText}`
      : `Giveaway ended! Winner${winners.length === 1 ? "" : "s"}: ${winnerText}`
  );
}

function scheduleGiveaway(client, messageId) {
  const giveaway = state.giveaways[messageId];
  if (!giveaway || giveaway.ended) return;
  const remaining = giveaway.endsAt - Date.now();
  setTimeout(() => {
    if (Date.now() < giveaway.endsAt) {
      scheduleGiveaway(client, messageId);
      return;
    }
    finishGiveaway(client, messageId).catch((error) =>
      console.error(`Could not finish giveaway ${messageId}:`, error)
    );
  }, Math.max(0, Math.min(remaining, 2_147_000_000)));
}

function panelEmbed(title, description) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x5865f2);
}

async function postPanel(interaction, commandName) {
  if (commandName === "rolepanel") {
    const configuredRoles = (process.env.ROLE_PANEL_ROLE_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const roles = configuredRoles
      .map((id) => interaction.guild.roles.cache.get(id))
      .filter((role) => role && role.id !== interaction.guild.id)
      .slice(0, 5);
    if (!roles.length) {
      await interaction.reply({
        content: "Set ROLE_PANEL_ROLE_IDS in .env to role IDs (up to 5), then restart the bot.",
        ephemeral: true,
      });
      return;
    }
    const row = new ActionRowBuilder().addComponents(
      ...roles.map((role) =>
        new ButtonBuilder()
          .setCustomId(`selfrole:${role.id}`)
          .setLabel(role.name.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
      )
    );
    await interaction.channel.send({
      embeds: [panelEmbed("Notification roles", "Click a button to toggle the matching role.")],
      components: [row],
    });
    await interaction.reply({ content: "Role panel posted.", ephemeral: true });
    return;
  }

  if (commandName === "ticketpanel") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("ticket:create")
      .setPlaceholder("Choose a ticket type")
      .addOptions(TICKET_TYPES);
    const description = [
      "Need a bot, a logo, an embed, a banner, map edits, or server help? Pick the option that best matches your request and a private ticket will be opened for you.",
      "",
      ...TICKET_TYPES.map((type) => `• **${type.label}** — ${type.description}`),
    ].join("\n");
    await interaction.channel.send({
      embeds: [
        panelEmbed("Nova ERLC | Ticket System", description).setFooter({
          text: "Nova ERLC • Services • Support • Orders",
        }),
      ],
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    await interaction.reply({ content: "Ticket panel posted.", ephemeral: true });
    return;
  }

  if (commandName === "verifybot") {
    const description = [
      "Until you verify, you can only view the arrivals and verification channels and cannot chat. Click Verify below to receive the ✅ Verified role and access the community.",
      "",
      "**Need help?**",
      "Use 🆘 • **help-desk** or open a support ticket.",
    ].join("\n");
    await interaction.channel.send({
      embeds: [panelEmbed("✅ Nova ERLC Verification", description)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("verify:member")
            .setLabel("✅ Verify")
            .setStyle(ButtonStyle.Success)
        ),
      ],
    });
    await interaction.reply({ content: "Verification panel posted.", ephemeral: true });
    return;
  }

  const titleByCommand = {
    infopanel: "Server Information",
    paidpanel: "Paid Advertisement",
    partnershippanel: "Partnerships",
    rules: "Server Rules",
    welcomepanel: "Welcome",
  };
  await interaction.channel.send({
    embeds: [panelEmbed(titleByCommand[commandName], PANEL_TEXT[commandName])],
  });
  await interaction.reply({ content: "Panel posted.", ephemeral: true });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag} — 2 Nova ERLC Designs`);
  for (const [messageId, giveaway] of Object.entries(state.giveaways)) {
    if (!giveaway.ended) scheduleGiveaway(client, messageId);
  }
});

client.on("guildMemberAdd", async (member) => {
  if (!state.welcomeEnabled[member.guild.id]) return;
  try {
    const channel = member.guild.systemChannel;
    if (channel) {
      await channel.send(`Welcome to **${member.guild.name}**, ${member}! Please read the rules and verify.`);
    }
  } catch (error) {
    console.error(`Could not send a welcome message for ${member.user.tag}:`, error);
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const command = message.content.trim().toLowerCase();
  if (!["!lock", "!unlock", "!clear"].includes(command)) return;

  try {
    if (command === "!clear") {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await message.reply("You need the **Manage Messages** permission to use `!clear`.");
        return;
      }
      if (!message.guild.members.me.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) {
        await message.reply("I need **Manage Messages** permission in this channel to clear it.");
        return;
      }

      let deletedCount = 0;
      let before;
      while (true) {
        const batch = await message.channel.messages.fetch({
          limit: 100,
          ...(before ? { before } : {}),
        });
        if (batch.size === 0) break;

        before = batch.last().id;
        const recentMessages = batch.filter(
          (entry) => Date.now() - entry.createdTimestamp < MESSAGE_BULK_DELETE_MAX_AGE
        );
        const oldMessages = batch.filter(
          (entry) => Date.now() - entry.createdTimestamp >= MESSAGE_BULK_DELETE_MAX_AGE
        );

        if (recentMessages.size) {
          const deleted = await message.channel.bulkDelete(recentMessages);
          deletedCount += deleted.size;
        }
        for (const oldMessage of oldMessages.values()) {
          await oldMessage.delete();
          deletedCount += 1;
        }
      }

      const confirmation = await message.channel.send(
        `🧹 Cleared ${deletedCount} message${deletedCount === 1 ? "" : "s"}.`
      );
      setTimeout(() => {
        confirmation.delete().catch((error) => {
          if (error.code !== 10008) {
            console.error("Could not delete the clear confirmation:", error);
          }
        });
      }, 5_000);
      return;
    }

    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply("You need the **Manage Channels** permission to use this command.");
      return;
    }
    if (message.channel.isThread()) {
      await message.reply("Run this command in the channel that contains the thread.");
      return;
    }
    if (!message.guild.members.me.permissionsIn(message.channel).has(PermissionFlagsBits.ManageChannels)) {
      await message.reply("I need **Manage Channels** permission in this channel to change its chat permissions.");
      return;
    }

    const locked = command === "!lock";
    await message.channel.permissionOverwrites.edit(
      message.guild.roles.everyone,
      {
        SendMessages: !locked,
        SendMessagesInThreads: !locked,
        CreatePublicThreads: !locked,
        CreatePrivateThreads: !locked,
      },
      { reason: `${message.author.tag} used ${command}` }
    );
    await message.channel.send(
      locked ? "🔒 This channel is locked. Members can no longer send messages." : "🔓 This channel is unlocked."
    );
  } catch (error) {
    console.error(`Prefix command ${command} failed:`, error);
    await message.reply(`Couldn't complete \`${command}\`: ${error.message}`).catch((replyError) =>
      console.error("Could not send prefix-command error reply:", replyError)
    );
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "giveaway") {
        const action = interaction.options.getSubcommand();
        if (action === "start") {
          const duration = parseDuration(interaction.options.getString("duration", true));
          if (!duration) {
            await interaction.reply({ content: "Use a duration like `30m`, `2h`, or `1d`.", ephemeral: true });
            return;
          }
          const channel = interaction.options.getChannel("channel") || interaction.channel;
          const giveaway = {
            prize: interaction.options.getString("prize", true),
            winnerCount: interaction.options.getInteger("winners", true),
            channelId: channel.id,
            endsAt: Date.now() + duration,
            entrants: [],
            winnerIds: [],
            ended: false,
          };
          const message = await channel.send({ embeds: [giveawayEmbed(giveaway)] });
          state.giveaways[message.id] = giveaway;
          await message.edit({ components: [entryRow(message.id)] });
          saveState();
          scheduleGiveaway(client, message.id);
          await interaction.reply({ content: `Giveaway started in ${channel}.`, ephemeral: true });
          return;
        }
        const messageId = interaction.options.getString("message_id", true);
        await interaction.deferReply({ ephemeral: true });
        await finishGiveaway(client, messageId, action === "reroll");
        await interaction.editReply(action === "reroll" ? "A replacement winner was selected." : "Giveaway ended.");
        return;
      }

      if (interaction.commandName === "ticketroles") {
        const action = interaction.options.getSubcommand();
        const roles = state.ticketRoles[interaction.guildId] || [];
        if (action === "list") {
          await interaction.reply({
            content: roles.length ? roles.map((id) => `<@&${id}>`).join("\n") : "No extra ticket roles configured.",
            ephemeral: true,
          });
          return;
        }
        const role = interaction.options.getRole("role", true);
        if (action === "add") {
          if (!roles.includes(role.id)) roles.push(role.id);
        } else {
          state.ticketRoles[interaction.guildId] = roles.filter((id) => id !== role.id);
        }
        state.ticketRoles[interaction.guildId] = action === "add" ? roles : state.ticketRoles[interaction.guildId];
        saveState();
        await interaction.reply({
          content: action === "add" ? `Added ${role} to ticket notifications.` : `Removed ${role} from ticket notifications.`,
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "welcomemessages") {
        const enabled = interaction.options.getSubcommand() === "start";
        state.welcomeEnabled[interaction.guildId] = enabled;
        saveState();
        await interaction.reply({
          content: `Automatic welcome messages ${enabled ? "enabled" : "disabled"}.`,
          ephemeral: true,
        });
        return;
      }

      await postPanel(interaction, interaction.commandName);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("giveaway:enter:")) {
        const messageId = interaction.customId.split(":")[2];
        const giveaway = state.giveaways[messageId];
        if (!giveaway || giveaway.ended) {
          await interaction.reply({ content: "That giveaway is no longer active.", ephemeral: true });
          return;
        }
        if (!giveaway.entrants.includes(interaction.user.id)) giveaway.entrants.push(interaction.user.id);
        else giveaway.entrants = giveaway.entrants.filter((id) => id !== interaction.user.id);
        saveState();
        await interaction.update({
          embeds: [giveawayEmbed(giveaway)],
          components: [entryRow(messageId)],
        });
        return;
      }

      if (interaction.customId.startsWith("selfrole:")) {
        const roleId = interaction.customId.split(":")[1];
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) {
          await interaction.reply({ content: "That role is no longer available.", ephemeral: true });
          return;
        }
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
        else await member.roles.add(roleId);
        await interaction.reply({
          content: `Updated your ${role.name} role.`,
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === "verify:member") {
        const role = await getVerifiedRole(interaction.guild);
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.add(role);
        await interaction.reply({ content: "You're verified. Welcome!", ephemeral: true });
        return;
      }

      if (interaction.customId === "ticket:claim") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (
          !member.permissions.has(PermissionFlagsBits.ManageChannels) &&
          !member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
          await interaction.reply({
            content: "Only staff with **Manage Channels** or **Administrator** permission can claim tickets.",
            ephemeral: true,
          });
          return;
        }
        if (state.ticketClaims[interaction.channelId]) {
          await interaction.reply({
            content: `This ticket has already been claimed by <@${state.ticketClaims[interaction.channelId]}>.`,
            ephemeral: true,
          });
          return;
        }
        state.ticketClaims[interaction.channelId] = interaction.user.id;
        saveState();
        await interaction.message.edit({ components: [ticketControlRow(true)] });
        await interaction.channel.send(`🙋 ${interaction.user} claimed this ticket.`);
        await interaction.reply({ content: "You claimed this ticket.", ephemeral: true });
        return;
      }

      if (interaction.customId === "ticket:close-reason") {
        const modal = new ModalBuilder()
          .setCustomId(`ticket:close-reason-submit:${interaction.channelId}`)
          .setTitle("Close ticket with reason")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("reason")
                .setLabel("Reason for closing")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Enter the reason for closing this ticket")
                .setMaxLength(500)
                .setRequired(true)
            )
          );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "ticket:rename") {
        const modal = new ModalBuilder()
          .setCustomId(`ticket:rename-submit:${interaction.channelId}`)
          .setTitle("Rename ticket")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("channel-name")
                .setLabel("New ticket name")
                .setStyle(TextInputStyle.Short)
                .setValue(interaction.channel.name)
                .setMaxLength(100)
                .setRequired(true)
            )
          );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "ticket:close") {
        await interaction.reply({ content: "This ticket will close in 5 seconds.", ephemeral: true });
        const channel = interaction.channel;
        await channel.send(`🔒 Ticket closed by ${interaction.user}.`);
        setTimeout(() => {
          channel.delete("Ticket closed").catch((error) =>
            console.error(`Could not delete ticket ${channel.id}:`, error)
          );
        }, 5_000);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket:close-reason-submit:")) {
      const channelId = interaction.customId.slice("ticket:close-reason-submit:".length);
      if (channelId !== interaction.channelId) {
        await interaction.reply({ content: "This close request is for a different ticket.", ephemeral: true });
        return;
      }
      const reason = interaction.fields.getTextInputValue("reason").trim();
      await interaction.reply({ content: "This ticket will close in 5 seconds.", ephemeral: true });
      const channel = interaction.channel;
      await channel.send(`🔒 Ticket closed by ${interaction.user}.\n**Reason:** ${reason}`);
      setTimeout(() => {
        channel.delete(`Ticket closed by ${interaction.user.tag}: ${reason}`).catch((error) =>
          console.error(`Could not delete ticket ${channel.id}:`, error)
        );
      }, 5_000);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket:rename-submit:")) {
      const channelId = interaction.customId.slice("ticket:rename-submit:".length);
      if (channelId !== interaction.channelId || !interaction.channel?.isTextBased()) {
        await interaction.reply({ content: "This rename request is for a different ticket.", ephemeral: true });
        return;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const isTicketOwner = state.ticketOwners[channelId] === interaction.user.id;
      const isStaff =
        member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        member.permissions.has(PermissionFlagsBits.Administrator);
      if (!isTicketOwner && !isStaff) {
        await interaction.reply({
          content: "Only the ticket opener or staff can rename this ticket.",
          ephemeral: true,
        });
        return;
      }

      const requestedName = interaction.fields.getTextInputValue("channel-name");
      const channelName = requestedName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 100);
      if (!channelName) {
        await interaction.reply({
          content: "Enter a name with at least one letter or number.",
          ephemeral: true,
        });
        return;
      }

      await interaction.channel.setName(channelName, `Ticket renamed by ${interaction.user.tag}`);
      await interaction.reply({ content: `Ticket renamed to **#${channelName}**.`, ephemeral: true });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket:create") {
      const ticketType = TICKET_TYPES.find((type) => type.value === interaction.values[0]);
      if (!ticketType) {
        await interaction.reply({ content: "That ticket option is invalid. Please use the ticket panel again.", ephemeral: true });
        return;
      }
      const channelName = `ticket-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 90);
      const supportRoles = interaction.guild.roles.cache.filter(
        (role) =>
          role.id !== interaction.guild.id &&
          (role.permissions.has(PermissionFlagsBits.ManageChannels) ||
            role.permissions.has(PermissionFlagsBits.Administrator))
      );
      const ticketCategory = await getTicketCategory(interaction.guild, supportRoles);
      const overwrites = [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
        ...supportRoles.map((role) => ({
          id: role.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        })),
      ];
      const ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: ticketCategory.id,
        permissionOverwrites: overwrites,
      });
      state.ticketOwners[ticketChannel.id] = interaction.user.id;
      saveState();
      const configuredRoles = state.ticketRoles[interaction.guildId] || [];
      const notify = configuredRoles.map((id) => `<@&${id}>`).join(" ");
      await ticketChannel.send({
        content: `${interaction.user} opened a **${ticketType.label}** ticket.${notify ? ` ${notify}` : ""}`,
        components: [ticketControlRow()],
      });
      await interaction.reply({ content: `Your ticket is ready: ${ticketChannel}`, ephemeral: true });
      return;
    }

  } catch (error) {
    console.error("Interaction failed:", error);
    const response = {
      content: `That action failed: ${error.message || "Please contact a server administrator."}`,
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch((replyError) => console.error("Could not send error reply:", replyError));
    } else {
      await interaction.reply(response).catch((replyError) => console.error("Could not send error reply:", replyError));
    }
  }
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Could not log in. Check DISCORD_TOKEN in your .env file.", error);
  process.exitCode = 1;
});
