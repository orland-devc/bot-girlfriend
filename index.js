require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

const initializeReminders = require('./reminder/enhanced-reminder');
const initializeResponseSystem = require('./response/together');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessageTyping,
    ]
});

const CLOCKIFY_API_KEY = process.env.CLOCKIFY_API_KEY_2;
const WORKSPACE_ID = process.env.WORKSPACE_ID_2;
const API_BASE_URL = `https://api.clockify.me/api/v1`;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_USER_ID;

// Store temp data for message sending process
const pendingMessages = new Map();

client.once('ready', async () => {
    const currentDateTime = new Date().toLocaleString();
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Current date and time: ${currentDateTime}`); 
        
    const commands = [
        new SlashCommandBuilder().setName('clockin').setDescription('Clock in to Clockify'),
        new SlashCommandBuilder().setName('clockout').setDescription('Clock out from Clockify'),
        new SlashCommandBuilder().setName('clear').setDescription('Clear conversation with the bot'),
        new SlashCommandBuilder().setName('full-reset').setDescription('Resets the entire conversation with the bot'),
        new SlashCommandBuilder().setName('send-server').setDescription('Send a message to a specific server channel')
    ];
    
    await client.application.commands.set(commands);
    console.log('Slash commands registered.');
    
    const responseSystem = initializeResponseSystem(client);
    await responseSystem.setupMessageHandler(); 
    
    const reminderSystem = initializeReminders(client);
    reminderSystem.scheduleReminders();
});

async function fetchUser() {
    try {
        const response = await axios.get(`${API_BASE_URL}/workspaces/${WORKSPACE_ID}/users`, {
            headers: { 'X-Api-Key': CLOCKIFY_API_KEY }
        });
        return response.data.find(user => user.status === 'ACTIVE');
    } catch (error) {
        console.error('Error fetching user:', error);
        return null;
    }
}

async function fetchProjects() {
    try {
        const response = await axios.get(`${API_BASE_URL}/workspaces/${WORKSPACE_ID}/projects`, {
            headers: { 'X-Api-Key': CLOCKIFY_API_KEY }
        });
        return response.data.filter(project => !project.archived);
    } catch (error) {
        console.error('Error fetching projects:', error);
        return [];
    }
}

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'clockin') {
            await interaction.deferReply({ ephemeral: true });

            const user = await fetchUser();
            if (!user) {
                return interaction.editReply({ content: "Failed to retrieve user data from Clockify. ❌", ephemeral: true });
            }

            const projects = await fetchProjects();
            if (projects.length === 0) {
                return interaction.editReply({ content: "No active projects found in the workspace. ❌", ephemeral: true });
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('project_select')
                        .setPlaceholder('Select a project')
                        .addOptions(
                            projects.map(project => ({
                                label: project.name,
                                value: project.id,
                                description: project.clientName || 'No client'
                            })).slice(0, 25)
                        )
                );

            await interaction.editReply({
                content: `Hi ${interaction.user.username}! Please select a project to clock in to:`,
                components: [row],
                ephemeral: true
            });
        }
        else if (interaction.commandName === 'clockout') {
            try {
                await interaction.deferReply({ ephemeral: true });
                const user = await fetchUser();
                if (!user) {
                    return interaction.editReply({ content: "Failed to retrieve user data from Clockify. ❌", ephemeral: true });
                }

                await axios.patch(
                    `${API_BASE_URL}/workspaces/${WORKSPACE_ID}/user/${user.id}/time-entries`,
                    { end: new Date().toISOString() },
                    { headers: { 'X-Api-Key': CLOCKIFY_API_KEY } }
                );

                await interaction.editReply({ content: 'You have successfully clocked out! ✅', ephemeral: true });
            } catch (error) {
                console.error('Clockout error:', error);
                await interaction.editReply({ content: `Failed to clock out. ❌ Error: ${error.message}`, ephemeral: true });
            }
        }
        else if (interaction.commandName === 'clear') {
            if (!interaction.channel.isDMBased()) {
                return interaction.reply({ content: "This command only works in DMs!", ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            try {
                const messages = await interaction.channel.messages.fetch({ limit: 50 });
                const botMessages = messages.filter(msg => msg.author.id === client.user.id).first(20);

                for (const message of botMessages) {
                    await message.delete();
                }

                await interaction.editReply({ content: "Last 20 bot messages deleted! 🧹", ephemeral: true });
            } catch (error) {
                console.error("Clear command error:", error);
                await interaction.editReply({ content: "Failed to clear chat. ❌", ephemeral: true });
            }
        }
        else if (interaction.commandName === 'full-reset') {
            if (!interaction.channel.isDMBased()) {
                return interaction.reply({ content: "This command only works in DMs!", ephemeral: true });
            }
        
            await interaction.deferReply({ ephemeral: true });
        
            const confirmationRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_full_reset')
                        .setLabel('Confirm Reset')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_full_reset')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
        
            await interaction.editReply({
                content: "⚠️ Are you sure you want to reset this conversation? This will delete all bot messages.",
                components: [confirmationRow],
                ephemeral: true
            });
        }
        else if (interaction.commandName === 'send-server') {
            // Validate it's in DM and from the owner
            if (!interaction.channel.isDMBased()) {
                return interaction.reply({ content: "This command only works in DMs!", ephemeral: true });
            }
            
            if (interaction.user.id !== OWNER_ID) {
                return interaction.reply({ content: "This command is only available to the bot owner.", ephemeral: true });
            }
            
            try {
                await interaction.deferReply({ ephemeral: true });
                
                // Get all servers (guilds) the bot is in
                const guilds = client.guilds.cache.map(guild => ({
                    label: guild.name.substring(0, 25), // Truncate name if too long
                    value: guild.id,
                    description: `${guild.memberCount} members`
                }));
                
                if (guilds.length === 0) {
                    return interaction.editReply({ content: "I'm not in any servers yet!", ephemeral: true });
                }
                
                const serverRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('server_select')
                            .setPlaceholder('Select a server')
                            .addOptions(guilds.slice(0, 25)) // Discord has a limit of 25 options
                    );
                
                await interaction.editReply({
                    content: `Please select a server to send a message to:`,
                    components: [serverRow],
                    ephemeral: true
                });
            } catch (error) {
                console.error('Send-server command error:', error);
                await interaction.followUp({ 
                    content: `Error processing command: ${error.message}`, 
                    ephemeral: true 
                }).catch(console.error);
            }
        }
    }
    
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'project_select') {
            const selectedProjectId = interaction.values[0];
            
            const modal = new ModalBuilder()
                .setCustomId(`clockin_modal_${selectedProjectId}`)
                .setTitle('Clock In Description')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('description')
                            .setLabel('Optional description')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                    )
                );

            await interaction.showModal(modal);
        }
        else if (interaction.customId === 'server_select') {
            try {
                const selectedGuildId = interaction.values[0];
                const guild = client.guilds.cache.get(selectedGuildId);
                
                if (!guild) {
                    return interaction.update({ 
                        content: "Error: Could not find the selected server.", 
                        components: [], 
                        ephemeral: true 
                    });
                }
                
                // Get text channels the bot has permission to see and send messages in
                const channels = guild.channels.cache
                    .filter(channel => 
                        channel.isTextBased() && 
                        !channel.isThread() && 
                        channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
                    )
                    .map(channel => ({
                        label: channel.name.substring(0, 25),
                        value: channel.id,
                        description: channel.parent ? `Category: ${channel.parent.name.substring(0, 20)}` : 'No category'
                    }));
                
                if (channels.length === 0) {
                    return interaction.update({ 
                        content: "No suitable text channels found in this server, or I don't have permission to send messages.", 
                        components: [], 
                        ephemeral: true 
                    });
                }
                
                const channelRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`channel_select_${selectedGuildId}`)
                            .setPlaceholder('Select a channel')
                            .addOptions(channels.slice(0, 25))
                    );
                
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('back_to_servers')
                            .setLabel('Back to server selection')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                await interaction.update({
                    content: `Please select a channel in **${guild.name}**:`,
                    components: [channelRow, backButton],
                    ephemeral: true
                });
            } catch (error) {
                console.error('Server select error:', error);
                await interaction.update({ 
                    content: `Error selecting server: ${error.message}. Please try again.`, 
                    components: [], 
                    ephemeral: true 
                }).catch(console.error);
            }
        }
        else if (interaction.customId.startsWith('channel_select_')) {
            try {
                const guildId = interaction.customId.split('_').pop();
                const channelId = interaction.values[0];
                
                const guild = client.guilds.cache.get(guildId);
                const channel = guild?.channels.cache.get(channelId);
                
                if (!guild || !channel) {
                    return interaction.update({ 
                        content: "Error: Could not find the selected server or channel.", 
                        components: [], 
                        ephemeral: true 
                    });
                }
                
                // Store the selected channel info for this user
                pendingMessages.set(interaction.user.id, {
                    guildId,
                    channelId,
                    guildName: guild.name,
                    channelName: channel.name
                });
                
                // Create text input button
                const messageRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('enter_message')
                            .setLabel('Enter Message')
                            .setStyle(ButtonStyle.Primary)
                    );
                
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('back_to_channels')
                            .setLabel('Back to channel selection')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                await interaction.update({
                    content: `You've selected channel **#${channel.name}** in **${guild.name}**. Click the button below to enter your message:`,
                    components: [messageRow, backButton],
                    ephemeral: true
                });
            } catch (error) {
                console.error('Channel select error:', error);
                await interaction.update({ 
                    content: `Error selecting channel: ${error.message}. Please try again.`, 
                    components: [], 
                    ephemeral: true 
                }).catch(console.error);
            }
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('clockin_modal_')) {
            try {
                const user = await fetchUser();
                if (!user) {
                    return interaction.reply({ content: "Failed to retrieve user data from Clockify. ❌", ephemeral: true });
                }

                const selectedProjectId = interaction.customId.split('_').pop();
                const description = interaction.fields.getTextInputValue('description') || 'No description provided';
                const projects = await fetchProjects();
                const project = projects.find(proj => proj.id === selectedProjectId);
                
                const response = await axios.post(
                    `${API_BASE_URL}/workspaces/${WORKSPACE_ID}/user/${user.id}/time-entries`,
                    { start: new Date().toISOString(), projectId: selectedProjectId, billable: true, description },
                    { headers: { 'X-Api-Key': CLOCKIFY_API_KEY } }
                );

                console.log('Clock in response:', JSON.stringify(response.data, null, 2));
                await interaction.update({ content: `You have successfully clocked in! ✅\nProject: **${project ? project.name : 'Unknown'}**\nDescription: **${description}**`, components: [], ephemeral: true });
            } catch (error) {
                console.error('Clock-in error:', error);
                await interaction.reply({ content: `Failed to clock in: ${error.message} ❌`, ephemeral: true });
            }
        }
        else if (interaction.customId === 'message_modal') {
            try {
                await interaction.deferUpdate({ ephemeral: true });
                
                const messageContent = interaction.fields.getTextInputValue('message_content');
                const pendingData = pendingMessages.get(interaction.user.id);
                
                if (!pendingData) {
                    return interaction.followUp({ 
                        content: "Your session has expired. Please start again with /send-server.", 
                        ephemeral: true 
                    });
                }
                
                const { guildId, channelId, guildName, channelName } = pendingData;
                const guild = client.guilds.cache.get(guildId);
                const channel = guild?.channels.cache.get(channelId);
                
                if (!guild || !channel) {
                    return interaction.followUp({ 
                        content: "Error: Could not find the selected server or channel.", 
                        ephemeral: true 
                    });
                }
                
                // Send the message to the selected channel
                await channel.send(messageContent).catch(error => {
                    throw new Error(`Failed to send message: ${error.message}`);
                });
                
                // Clean up stored data
                pendingMessages.delete(interaction.user.id);
                
                // Show success message with a button to send another message
                const newMessageRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('new_server_message')
                            .setLabel('Send Another Message')
                            .setStyle(ButtonStyle.Primary)
                    );
                
                await interaction.followUp({ 
                    content: `✅ Message sent successfully to #${channelName} in ${guildName}!`, 
                    components: [newMessageRow],
                    ephemeral: true 
                });
            } catch (error) {
                console.error('Send message error:', error);
                await interaction.followUp({ 
                    content: `❌ Error: ${error.message}`, 
                    ephemeral: true 
                }).catch(console.error);
                
                // Don't delete pendingMessages here to allow retry
                const retryRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('enter_message')
                            .setLabel('Try Again')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('back_to_servers')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary)
                    );
                    
                await interaction.followUp({
                    content: "Would you like to try sending the message again?",
                    components: [retryRow],
                    ephemeral: true
                }).catch(console.error);
            }
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'confirm_full_reset') {
            await interaction.deferReply({ ephemeral: true });
    
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                const botMessages = messages.filter(msg => msg.author.id === client.user.id);
    
                for (const message of botMessages.values()) {
                    await message.delete();
                }
    
                await interaction.editReply({ content: "DM conversation reset! 🔄", ephemeral: true });
            } catch (error) {
                console.error("Full reset error:", error);
                await interaction.editReply({ content: "Failed to reset conversation. ❌", ephemeral: true });
            }
        } 
        else if (interaction.customId === 'cancel_full_reset') {
            await interaction.reply({ content: "Reset canceled. ✅", ephemeral: true });
        }
        else if (interaction.customId === 'enter_message') {
            try {
                const pendingData = pendingMessages.get(interaction.user.id);
                
                if (!pendingData) {
                    return interaction.reply({ 
                        content: "Your session has expired. Please start again with /send-server.", 
                        ephemeral: true 
                    });
                }
                
                // Show a modal for message input
                const modal = new ModalBuilder()
                    .setCustomId('message_modal')
                    .setTitle(`Send Message to #${pendingData.channelName}`);
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('message_content')
                            .setLabel('Message')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('Enter the message you want to send...')
                            .setRequired(true)
                            .setMaxLength(2000)
                    )
                );
                
                await interaction.showModal(modal);
            } catch (error) {
                console.error('Show modal error:', error);
                await interaction.reply({ 
                    content: `Error opening message form: ${error.message}`, 
                    ephemeral: true 
                }).catch(console.error);
            }
        }
        else if (interaction.customId === 'back_to_servers') {
            try {
                // Start over with server selection
                const guilds = client.guilds.cache.map(guild => ({
                    label: guild.name.substring(0, 25),
                    value: guild.id,
                    description: `${guild.memberCount} members`
                }));
                
                const serverRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('server_select')
                            .setPlaceholder('Select a server')
                            .addOptions(guilds.slice(0, 25))
                    );
                
                await interaction.update({
                    content: `Please select a server to send a message to:`,
                    components: [serverRow],
                    ephemeral: true
                });
                
                // Clean up stored data
                pendingMessages.delete(interaction.user.id);
            } catch (error) {
                console.error('Back button error:', error);
                await interaction.update({ 
                    content: `Error: ${error.message}. Please try again with /send-server.`, 
                    components: [], 
                    ephemeral: true 
                }).catch(console.error);
            }
        }
        else if (interaction.customId === 'back_to_channels') {
            try {
                const pendingData = pendingMessages.get(interaction.user.id);
                if (!pendingData || !pendingData.guildId) {
                    return interaction.update({
                        content: "Session expired. Please use /send-server to start again.",
                        components: [],
                        ephemeral: true
                    });
                }
                
                const guildId = pendingData.guildId;
                const guild = client.guilds.cache.get(guildId);
                
                if (!guild) {
                    return interaction.update({ 
                        content: "Error: Could not find the selected server.", 
                        components: [], 
                        ephemeral: true 
                    });
                }
                
                // Get text channels again
                const channels = guild.channels.cache
                    .filter(channel => 
                        channel.isTextBased() && 
                        !channel.isThread() && 
                        channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
                    )
                    .map(channel => ({
                        label: channel.name.substring(0, 25),
                        value: channel.id,
                        description: channel.parent ? `Category: ${channel.parent.name.substring(0, 20)}` : 'No category'
                    }));
                
                const channelRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`channel_select_${guildId}`)
                            .setPlaceholder('Select a channel')
                            .addOptions(channels.slice(0, 25))
                    );
                
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('back_to_servers')
                            .setLabel('Back to server selection')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                await interaction.update({
                    content: `Please select a channel in **${guild.name}**:`,
                    components: [channelRow, backButton],
                    ephemeral: true
                });
            } catch (error) {
                console.error('Back to channels error:', error);
                await interaction.update({ 
                    content: `Error: ${error.message}. Please try again with /send-server.`, 
                    components: [], 
                    ephemeral: true 
                }).catch(console.error);
            }
        }
        else if (interaction.customId === 'new_server_message') {
            try {
                // Restart the server selection process
                const guilds = client.guilds.cache.map(guild => ({
                    label: guild.name.substring(0, 25),
                    value: guild.id,
                    description: `${guild.memberCount} members`
                }));
                
                const serverRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('server_select')
                            .setPlaceholder('Select a server')
                            .addOptions(guilds.slice(0, 25))
                    );
                
                await interaction.update({
                    content: `Please select a server to send a message to:`,
                    components: [serverRow],
                    ephemeral: true
                });
            } catch (error) {
                console.error('New message button error:', error);
                await interaction.update({ 
                    content: `Error: ${error.message}. Please try again with /send-server.`, 
                    components: [], 
                    ephemeral: true 
                }).catch(console.error);
            }
        }
    }
});

client.login(DISCORD_TOKEN);