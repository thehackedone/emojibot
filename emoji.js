const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const twemoji = require('twemoji');

require('dotenv').config();
const TOKEN = process.env.DISCORD_TOKEN || ''; // TODO: Add your bot token here
const CLIENT_ID = ''; // TODO: Add your bot client ID here

// Role IDs for gem reaction milestones
const ROLE_MILESTONES = {
  50: '',  // TODO: Add role ID for 50 gem reactions
  150: '', // TODO: Add role ID for 150 gem reactions
  250: ''  // TODO: Add role ID for 250 gem reactions
};

// User IDs to DM for unused custom emojis
const DM_USER_IDS = ['']; // TODO: Add user ID(s) for DM notifications

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildMembers
  ]
});

const EMOJI_DIR = path.join(__dirname, 'emojis');
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(EMOJI_DIR)) {
  fs.mkdirSync(EMOJI_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

let reactionData = {};
if (fs.existsSync('./reactions.json')) {
  try {
    reactionData = JSON.parse(fs.readFileSync('./reactions.json', 'utf8'));
    console.log('Loaded existing reaction data:', Object.keys(reactionData).length, 'users');
  } catch (error) {
    console.error('Error loading reactions.json:', error.message);
    reactionData = {};
  }
}

let emojiUsage = {};
if (fs.existsSync('./emoji_usage.json')) {
  try {
    emojiUsage = JSON.parse(fs.readFileSync('./emoji_usage.json', 'utf8'));
    console.log('Loaded existing emoji usage data:', Object.keys(emojiUsage).length, 'emojis');
  } catch (error) {
    console.error('Error loading emoji_usage.json:', error.message);
    emojiUsage = {};
  }
}

function saveData() {
  try {
    fs.writeFileSync('./reactions.json', JSON.stringify(reactionData, null, 2));
    console.log('Saved reaction data');
  } catch (error) {
    console.error('Error saving reaction data:', error.message);
  }
}

function saveEmojiUsage() {
  try {
    fs.writeFileSync('./emoji_usage.json', JSON.stringify(emojiUsage, null, 2));
    console.log('Saved emoji usage data');
  } catch (error) {
    console.error('Error saving emoji_usage.json:', error.message);
  }
}

async function cacheEmoji(emojiId, emojiName, isUnicode = false, retries = 2) {
  const filePath = path.join(EMOJI_DIR, `${emojiId}.png`);
  const tempFilePath = path.join(EMOJI_DIR, `${emojiId}_temp.png`);

  if (fs.existsSync(filePath)) {
    console.log(`Emoji ${emojiName}:${emojiId} already cached`);
    return true;
  }

  let url;
  if (isUnicode) {
    url = `https://raw.githubusercontent.com/jdecked/twemoji/main/assets/72x72/${emojiId}.png`;
  } else {
    url = `https://cdn.discordapp.com/emojis/${emojiId}.png`;
  }
  console.log(`Attempting to download emoji ${emojiName}:${emojiId} from ${url}`);

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const success = await new Promise((resolve) => {
        const file = fs.createWriteStream(tempFilePath);
        https.get(url, (response) => {
          if (response.statusCode !== 200) {
            console.error(`Failed to download ${emojiId}: Status ${response.statusCode}`);
            fs.unlink(tempFilePath, (err) => {
              if (err) console.error(`Error deleting temp file ${tempFilePath}:`, err.message);
            });
            return resolve(false);
          }
          response.pipe(file);
          file.on('finish', async () => {
            file.close();
            try {
              await sharp(tempFilePath)
                .resize(32, 32, {
                  fit: 'contain',
                  background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .toFile(filePath);
              console.log(`Successfully cached and resized emoji ${emojiName}:${emojiId}`);
              fs.unlink(tempFilePath, (err) => {
                if (err) console.error(`Error deleting temp file ${tempFilePath}:`, err.message);
              });
              resolve(true);
            } catch (error) {
              console.error(`Error resizing emoji ${emojiId}:`, error.message);
              fs.unlink(tempFilePath, (err) => {
                if (err) console.error(`Error deleting temp file ${tempFilePath}:`, err.message);
              });
              fs.unlink(filePath, (err) => {
                if (err) console.error(`Error deleting file ${filePath}:`, err.message);
              });
              resolve(false);
            }
          });
        }).on('error', (err) => {
          fs.unlink(tempFilePath, (err) => {
            if (err) console.error(`Error deleting temp file ${tempFilePath}:`, err.message);
          });
          console.error(`Error downloading emoji ${emojiId} (attempt ${attempt}):`, err.message);
          resolve(false);
        });
      });
      if (success) return true;
      if (attempt < retries + 1) {
        console.log(`Retrying download for ${emojiId} (${attempt}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Unexpected error during download of ${emojiId}:`, error.message);
    }
  }
  return false;
}

function getEmojiCodePoint(emoji) {
  const codePoints = [];
  for (let i = 0; i < emoji.length; i++) {
    const codePoint = emoji.codePointAt(i);
    if (codePoint) {
      codePoints.push(codePoint.toString(16));
      if (codePoint > 0xffff) i++;
    }
  }
  return codePoints.join('-');
}

async function generateStatsImage(emojiData, username) {
  const itemsPerPage = 10;
  const width = 400;
  const height = 40 * itemsPerPage + 50;
  const fontSize = 20;
  const countFontSize = 32;
  const emojiSize = 32;

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .username { font-family: Arial; font-size: 24px; fill: #ffffff; }
        .text { font-family: Arial; font-size: ${fontSize}px; fill: #ffffff; }
        .count { font-family: Arial; font-size: ${countFontSize}px; fill: #ffffff; font-weight: bold; }
      </style>
      <rect width="100%" height="100%" fill="#2f3136"/>
      <text x="10" y="30" class="username">${username}'s Reactions</text>
    </svg>
  `;

  let svgBuffer = Buffer.from(svg);
  let yOffset = 50;

  const compositeOperations = [];
  for (let i = 0; i < Math.min(itemsPerPage, emojiData.length); i++) {
    const [emojiKey, count] = emojiData[i];
    let emojiPath = null;
    let emojiId;
    let emojiName;

    if (emojiKey.includes(':')) {
      [emojiName, emojiId] = emojiKey.split(':');
      emojiPath = path.join(EMOJI_DIR, `${emojiId}.png`);
      if (!fs.existsSync(emojiPath)) {
        const success = await cacheEmoji(emojiId, emojiName, false);
        if (!success) {
          emojiPath = null;
        }
      }
    } else {
      emojiName = emojiKey;
      emojiId = getEmojiCodePoint(emojiKey);
      emojiPath = path.join(EMOJI_DIR, `${emojiId}.png`);
      if (!fs.existsSync(emojiPath)) {
        const success = await cacheEmoji(emojiId, emojiName, true);
        if (!success) {
          emojiPath = null;
        }
      }
    }

    if (emojiPath) {
      compositeOperations.push({
        input: emojiPath,
        top: yOffset + Math.floor((countFontSize - emojiSize) / 2),
        left: 10
      });
    }

    const textSvg = `
      <svg width="${width}" height="${countFontSize + 10}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .text { font-family: Arial; font-size: ${fontSize}px; fill: #ffffff; }
          .count { font-family: Arial; font-size: ${countFontSize}px; fill: #ffffff; font-weight: bold; }
        </style>
        <text x="${emojiPath ? 50 : 10}" y="${fontSize}" class="text">${emojiPath ? '' : emojiKey}</text>
        <text x="${emojiPath ? 60 : emojiKey.length * 10 + 30}" y="${countFontSize}" class="count">${count}</text>
      </svg>
    `;
    compositeOperations.push({
      input: Buffer.from(textSvg),
      top: yOffset,
      left: 0
    });

    yOffset += 40;
  }

  const image = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 47, g: 49, b: 54, alpha: 1 }
    }
  })
    .composite([{ input: svgBuffer }, ...compositeOperations])
    .png()
    .toBuffer();

  const tempFilePath = path.join(TEMP_DIR, `stats_${Date.now()}.png`);
  await sharp(image).toFile(tempFilePath);
  return tempFilePath;
}

async function checkAndAssignRoles(userId, guild, gemCount) {
  console.log(`Checking roles for user ${userId} with ${gemCount} gem reactions in guild ${guild.name}`);
  const member = await guild.members.fetch(userId).catch((error) => {
    console.error(`Failed to fetch member ${userId}: ${error.message}`);
    return null;
  });
  if (!member) return;

  const milestones = Object.keys(ROLE_MILESTONES).map(Number).sort((a, b) => b - a);
  let highestEligibleRole = null;

  for (const milestone of milestones) {
    if (gemCount >= milestone) {
      highestEligibleRole = ROLE_MILESTONES[milestone];
      break;
    }
  }

  if (highestEligibleRole) {
    const role = guild.roles.cache.get(highestEligibleRole);
    if (!role) {
      console.error(`Role ${highestEligibleRole} not found in guild ${guild.name}`);
      return;
    }
    // Check if user already has the highest eligible role
    if (member.roles.cache.has(highestEligibleRole)) {
      console.log(`User ${member.user.tag} already has role ${role.name} for ${gemCount} gem reactions`);
      return; // Exit if the user already has the correct role
    }
    try {
      await member.roles.add(role);
      console.log(`Assigned role ${role.name} to ${member.user.tag} for ${gemCount} gem reactions`);
      
      // Remove lower-tier roles only after successfully adding the new role
      for (const milestone of milestones) {
        if (milestone < gemCount && ROLE_MILESTONES[milestone] !== highestEligibleRole) {
          const lowerRoleId = ROLE_MILESTONES[milestone];
          const lowerRole = guild.roles.cache.get(lowerRoleId);
          if (lowerRole && member.roles.cache.has(lowerRoleId)) {
            try {
              await member.roles.remove(lowerRole);
              console.log(`Removed lower-tier role ${lowerRole.name} from ${member.user.tag}`);
            } catch (error) {
              console.error(`Failed to remove lower-tier role ${lowerRole.name} from ${member.user.tag}: ${error.message}`);
              const admin = await client.users.fetch(DM_USER_IDS[0]).catch(() => null);
              if (admin) {
                await admin.send(`Error removing role ${lowerRole.name} from ${member.user.tag}: ${error.message}`).catch((err) => console.error(`Failed to DM admin: ${err.message}`));
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to assign role ${role.name} to ${member.user.tag}: ${error.message}`);
      const admin = await client.users.fetch(DM_USER_IDS[0]).catch(() => null);
      if (admin) {
        await admin.send(`Error assigning role ${role.name} to ${member.user.tag}: ${error.message}`).catch((err) => console.error(`Failed to DM admin: ${err.message}`));
      }
    }
  }
}

async function checkUnusedEmojis() {
  const threeMonths = 1000 * 60 * 60 * 24 * 90; // 90 days in milliseconds
  const now = Date.now();

  for (const guild of client.guilds.cache.values()) {
    const customEmojis = guild.emojis.cache;
    for (const emoji of customEmojis.values()) {
      const emojiKey = `${emoji.name}:${emoji.id}`;
      const lastUsed = emojiUsage[emojiKey]?.lastUsed || 0;

      if (now - lastUsed > threeMonths) {
        for (const userId of DM_USER_IDS) {
          const user = await client.users.fetch(userId).catch(() => null);
          if (user) {
            await user.send(`Custom emoji \`${emoji.name}\` (ID: ${emoji.id}) in ${guild.name} hasn't been used in over 3 months.`).catch((err) => console.error(`Failed to DM user ${userId}: ${err.message}`));
          }
        }
      }
    }
  }
}

// Run emoji usage check every 24 hours
setInterval(checkUnusedEmojis, 24 * 60 * 60 * 1000);

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Get reaction stats for a user')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to check (defaults to you)')
          .setRequired(false))
      .addIntegerOption(option =>
        option.setName('page')
          .setDescription('Page number to view (default: 1)')
          .setRequired(false)),
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show top users by reaction count')
      .addIntegerOption(option =>
        option.setName('page')
          .setDescription('Page number to view')
          .setRequired(false))
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Successfully registered slash commands!');
  } catch (error) {
    console.error('Error registering commands:', error.message);
  }

  // Initial check for unused emojis on startup
  await checkUnusedEmojis();
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.message.partial) {
    await reaction.message.fetch().catch((err) => console.error(`Failed to fetch message: ${err.message}`));
  }

  const message = reaction.message;
  const targetUser = message.author.id;
  const emojiKey = reaction.emoji.id 
    ? `${reaction.emoji.name}:${reaction.emoji.id}` 
    : reaction.emoji.name;

  // Update emoji usage for custom emojis
  if (reaction.emoji.id) {
    emojiUsage[emojiKey] = {
      lastUsed: Date.now(),
      count: (emojiUsage[emojiKey]?.count || 0) + 1
    };
    saveEmojiUsage();
    await cacheEmoji(reaction.emoji.id, reaction.emoji.name, false);
  } else {
    const emojiId = getEmojiCodePoint(reaction.emoji.name);
    await cacheEmoji(emojiId, reaction.emoji.name, true);
  }

  if (!reactionData[targetUser]) {
    reactionData[targetUser] = { total: 0, emojis: {} };
  }

  reactionData[targetUser].emojis[emojiKey] = (reactionData[targetUser].emojis[emojiKey] || 0) + 1;
  reactionData[targetUser].total += 1;

  // Check for gem emoji specifically (💎)
  if (emojiKey === '💎') {
    const gemCount = reactionData[targetUser].emojis[emojiKey] || 0;
    console.log(`Gem reaction added for ${targetUser}: ${gemCount} gems`);
    if (message.guild) {
      await checkAndAssignRoles(targetUser, message.guild, gemCount);
    }
  }

  saveData();
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.message.partial) {
    await reaction.message.fetch().catch((err) => console.error(`Failed to fetch message: ${err.message}`));
  }

  const message = reaction.message;
  const targetUser = message.author.id;
  const emojiKey = reaction.emoji.id 
    ? `${reaction.emoji.name}:${reaction.emoji.id}` 
    : reaction.emoji.name;

  if (reactionData[targetUser] && reactionData[targetUser].emojis[emojiKey]) {
    reactionData[targetUser].emojis[emojiKey]--;
    reactionData[targetUser].total--;

    if (reactionData[targetUser].emojis[emojiKey] <= 0) {
      delete reactionData[targetUser].emojis[emojiKey];
    }
    if (reactionData[targetUser].total <= 0) {
      delete reactionData[targetUser];
    }

    // Update roles if gem emoji is removed
    if (emojiKey === '💎' && message.guild) {
      const gemCount = reactionData[targetUser].emojis[emojiKey] || 0;
      console.log(`Gem reaction removed for ${targetUser}: ${gemCount} gems`);
      await checkAndAssignRoles(targetUser, message.guild, gemCount);
    }

    saveData();
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'stats') {
    await interaction.deferReply();

    const target = interaction.options.getUser('user') || interaction.user;
    const page = interaction.options.getInteger('page') || 1;
    const itemsPerPage = 10;

    const userData = reactionData[target.id];
    if (!userData || userData.total === 0) {
      return interaction.editReply(`${target.tag} has no reactions yet!`);
    }

    const sortedEmojis = Object.entries(userData.emojis).sort(([, a], [, b]) => b - a);
    const totalPages = Math.ceil(sortedEmojis.length / itemsPerPage);

    if (page < 1 || page > totalPages) {
      return interaction.editReply(`Invalid page number! Please use a number between 1 and ${totalPages}.`);
    }

    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageEmojis = sortedEmojis.slice(startIndex, endIndex);

    try {
      const tempFilePath = await generateStatsImage(pageEmojis, target.tag);
      const attachment = new AttachmentBuilder(tempFilePath, { name: 'stats.png' });

      await interaction.editReply({
        content: `📊 **${target.tag}'s Reaction Stats (Page ${page}/${totalPages})**\n**Total Reactions:** ${userData.total}${totalPages > 1 ? `\n\nUse **/stats page:<number>** to see other pages!` : ''}`,
        files: [attachment],
        allowedMentions: { parse: [] }
      });

      fs.unlink(tempFilePath, (err) => {
        if (err) console.error(`Error deleting temp image ${tempFilePath}:`, err.message);
      });
    } catch (error) {
      console.error('Error generating stats image:', error.message);
      await interaction.editReply('Failed to generate stats image. Please try again.');
    }
  }

  if (commandName === 'leaderboard') {
    const page = interaction.options.getInteger('page') || 1;
    const itemsPerPage = 10;

    const sortedUsers = Object.entries(reactionData)
      .sort(([, a], [, b]) => b.total - a.total);

    if (sortedUsers.length === 0) {
      return interaction.reply('No reaction data yet!');
    }

    const totalPages = Math.ceil(sortedUsers.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;

    if (page < 1 || page > totalPages) {
      return interaction.reply(`Invalid page number! Please use a number between 1 and ${totalPages}.`);
    }

    const leaderboardPage = await Promise.all(
      sortedUsers.slice(startIndex, endIndex)
        .map(async ([userId, data], index) => {
          const user = await client.users.fetch(userId).catch(() => null);
          return `${startIndex + index + 1}. ${user ? user.tag : 'Unknown User'} - ${data.total} reactions`;
        })
    );

    await interaction.reply(`Reaction Leaderboard (Page ${page}/${totalPages}):\n${leaderboardPage.join('\n')}\n\nUse /leaderboard <page> to see other pages!`);
  }
});

client.login(TOKEN);