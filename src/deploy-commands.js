require("dotenv").config();

const { REST, Routes, SlashCommandBuilder, ChannelType } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create and manage giveaways")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Start a giveaway members can join with a button")
        .addStringOption((option) =>
          option.setName("prize").setDescription("What is being given away").setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("duration").setDescription("For example: 30m, 2h, or 1d").setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("winners")
            .setDescription("Number of winners")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Where the giveaway should be posted")
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("end")
        .setDescription("End an active giveaway early")
        .addStringOption((option) =>
          option.setName("message_id").setDescription("Giveaway message ID").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reroll")
        .setDescription("Pick a replacement winner for an ended giveaway")
        .addStringOption((option) =>
          option.setName("message_id").setDescription("Giveaway message ID").setRequired(true)
        )
    ),
  ...[
    ["infopanel", "Post the server information panel"],
    ["paidpanel", "Post the paid advertisement panel"],
    ["partnershippanel", "Post the partnership application panel"],
    ["rolepanel", "Post the notification self-role panel"],
    ["rules", "Post the server rules"],
    ["ticketpanel", "Post the ticket selection menu"],
    ["verifybot", "Post the verification panel"],
    ["welcomepanel", "Post the welcome panel"],
  ].map(([name, description]) =>
    new SlashCommandBuilder().setName(name).setDescription(description)
  ),
  new SlashCommandBuilder()
    .setName("ticketroles")
    .setDescription("Manage extra roles notified in tickets")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a role to ticket notifications")
        .addRoleOption((option) => option.setName("role").setDescription("Role to add").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List the extra roles configured for tickets")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a role from ticket notifications")
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to remove").setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName("welcomemessages")
    .setDescription("Control automatic welcome messages")
    .addSubcommand((subcommand) =>
      subcommand.setName("start").setDescription("Enable automatic welcome messages")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("stop").setDescription("Disable automatic welcome messages")
    ),
].map((command) => command.toJSON());

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("Set DISCORD_TOKEN, CLIENT_ID, and GUILD_ID in your .env file.");
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
rest
  .put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
  .then(() => console.log(`Registered ${commands.length} commands for guild ${GUILD_ID}.`))
  .catch((error) => {
    console.error("Failed to register slash commands:", error);
    process.exitCode = 1;
  });
