require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

// Import custom modules
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

// In index.js, update the initialization section:
client.once('ready', async () => {
    const currentDateTime = new Date().toLocaleString(); // Get the current date and time
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Current date and time: ${currentDateTime}`); // Log the time and date
        
    const commands = [
        new SlashCommandBuilder().setName('clockin').setDescription('Clock in to Clockify'),
        new SlashCommandBuilder().setName('clockout').setDescription('Clock out from Clockify'),
        new SlashCommandBuilder().setName('clear').setDescription('Clear conversation with the bot'),
        new SlashCommandBuilder().setName('full-reset').setDescription('Resets the entire conversation with the bot') 
    ];
    
    await client.application.commands.set(commands);
    console.log('Slash commands registered.');
    
    // Initialize the AI response system first (changed order)
    const responseSystem = initializeResponseSystem(client);
    await responseSystem.setupMessageHandler(); // Note: now awaiting this since it loads history
    
    // Initialize the reminder system after response system is ready
    const reminderSystem = initializeReminders(client);
    reminderSystem.scheduleReminders();
    // Removed welcome message since contextual greeting will be sent instead
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
        
            await interaction.deferReply({ ephemeral: true }); // Ensure interaction is deferred
        
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
        
        
    }
    
    if (interaction.isStringSelectMenu() && interaction.customId === 'project_select') {
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith('clockin_modal_')) {
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

    if (interaction.isButton()) {
        if (interaction.customId === 'confirm_full_reset') {
            await interaction.deferReply({ ephemeral: true }); // Defer reply to prevent timeout
    
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
        } else if (interaction.customId === 'cancel_full_reset') {
            await interaction.reply({ content: "Reset canceled. ✅", ephemeral: true });
        }
    }    
});

client.login(DISCORD_TOKEN);