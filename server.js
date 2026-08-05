// ============================================================
// server.js — Servidor Node.js Express de Webhook do Trello CRM
// (Suporta Meta Lead Ads, Zapier, Make.com e Formulários)
// ============================================================
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos do CRM
app.use(express.static(__dirname));

const fs = require('fs');

// Armazenamento em disco com backup permanente
const BACKUP_FILE = path.join(__dirname, 'leads_backup.json');
let serverLeads = [];

// Carregar backup existente do disco ao iniciar
if (fs.existsSync(BACKUP_FILE)) {
  try {
    const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
    serverLeads = JSON.parse(raw);
    console.log(`📁 Backup permanente carregado: ${serverLeads.length} leads restaurados do disco.`);
  } catch (err) {
    console.error('Erro ao ler backup do disco:', err);
    serverLeads = [];
  }
}

function saveBackupToDisk() {
  try {
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(serverLeads, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao salvar backup em disco:', err);
  }
}

const TEAM_CORRETORES = ['Flavia', 'Antonio', 'Yasmim'];
let lastIndex = 0;

function getNextRodizioCorretor() {
  const assigned = TEAM_CORRETORES[lastIndex];
  lastIndex = (lastIndex + 1) % TEAM_CORRETORES.length;
  return assigned;
}

// ── GET /api/webhook-lead (Verificação Oficial da Meta Lead Ads) ─────────
app.get('/api/webhook-lead', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'cury_crm_2026';

  if (mode && token === VERIFY_TOKEN) {
    console.log('✅ Webhook da Meta verificado com sucesso!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ── POST /api/webhook-lead (Recepção de Leads em Tempo Real) ────────────
app.post('/api/webhook-lead', (req, res) => {
  console.log('⚡ Novo Lead recebido via Webhook:', req.body);

  const payload = req.body;
  const assignedCorretor = getNextRodizioCorretor();

  // Extrair campos de forma flexível (Meta Ads, Zapier ou Make)
  const leadObj = {
    id: 'lead-' + Date.now(),
    nome: payload.nome || payload.name || payload.full_name || 'Lead de Anúncio',
    whatsapp: payload.whatsapp || payload.phone || payload.telefone || '',
    dataEntrada: new Date().toISOString().split('T')[0],
    empreendimento: payload.empreendimento || payload.produto || 'Empreendimento Cury',
    tags: [payload.regiao || 'LESTE', 'ANUNCIO', 'PRIMEIRA MENSAGEM'],
    customTags: payload.campanha || 'Meta Lead Ads',
    lembrete: '',
    ultimaConversa: payload.observacao || `[LEAD AUTOMÁTICO VIA WEBHOOK]\nCampanha: ${payload.campanha || 'Meta Ads'}\nCorretor Atribuído: ${assignedCorretor}\nRecebido em: ${new Date().toLocaleString('pt-BR')}`,
    coluna: 'PRIMEIRA MENSAGEM',
    origem: 'ANUNCIO',
    corretor: assignedCorretor
  };

  serverLeads.unshift(leadObj);
  saveBackupToDisk();

  return res.status(200).json({
    success: true,
    message: 'Lead recebido e cadastrado no Trello CRM com sucesso!',
    lead: leadObj
  });
});

// ── GET /api/leads ──────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  res.json(serverLeads);
});

// ── POST /api/leads/sync (Sincronização Bidirecional & Backup) ─────────
app.post('/api/leads/sync', (req, res) => {
  if (Array.isArray(req.body)) {
    serverLeads = req.body;
    saveBackupToDisk();
    return res.json({ success: true, message: 'Leads sincronizados com backup permanente em disco!' });
  }
  res.status(400).json({ error: 'Array de leads esperado' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor Trello CRM rodando na porta ${PORT}`);
  console.log(`🔗 Webhook pronto em: http://localhost:${PORT}/api/webhook-lead`);
  console.log(`🛡️ Sistema de Backup Permanente Ativo: ${BACKUP_FILE}`);
});
