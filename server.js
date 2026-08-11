// ============================================================
// server.js — Servidor Node.js Express de Webhook do Trello CRM
// (Suporta Meta Lead Ads, Zapier, Make.com e Formulários)
// ============================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// ── META CONVERSIONS API CONFIG ───────────────────────────────
const META_PIXEL_ID    = process.env.META_PIXEL_ID    || '1060504159774067';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || 'EAALGq7KI8DYBSKxGcQdFINOMNhWu8f1ewa0FsS6costifIWjwtZBPoswj4rNY4LUl0mxKPArjkZAbt7QdNZCTHh5R3jyvGHGQwX3MWftJjyNi9zwRaL1xd71a1g7ZCZCS8lBoAOzyTxSOQi1kkI2wKrBgrLEPOEOtRpyR5QyFJPnxZByz7mtmgbaCcwAADAgZDZD';
const META_API_VERSION = 'v19.0';

// Mapeamento de colunas do CRM para eventos padrão da Meta
const COLUNA_TO_META_EVENT = {
  'PRIMEIRA MENSAGEM': 'Lead',
  'EM ATENDIMENTO':    'Contact',
  '1º FOLLOW UP':     'Contact',
  'VISITA':           'Schedule',
  'DOCUMENTOS':       'CompleteRegistration',
  'CONTRATO':         'Purchase',
  'ESTUFA':           'Contact',
  'ENCERRADOS':       null  // Não envia evento para encerrados
};

// Hash SHA256 obrigatório pela Meta (LGPD/privacidade)
function sha256(value) {
  return crypto.createHash('sha256').update((value || '').trim().toLowerCase()).digest('hex');
}

// Envia evento para a Meta Conversions API
function sendMetaConversionEvent(eventName, lead) {
  return new Promise((resolve, reject) => {
    const eventTime = Math.floor(Date.now() / 1000);

    // Normaliza e faz hash do telefone (remove tudo que não é dígito, adiciona código do Brasil)
    const rawPhone = (lead.whatsapp || '').replace(/\D/g, '');
    const normalizedPhone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone;
    const hashedPhone = sha256(normalizedPhone);

    const payload = JSON.stringify({
      data: [{
        event_name:        eventName,
        event_time:        eventTime,
        action_source:     'crm',
        event_source_url:  'https://crm-backend-ssnt.onrender.com',
        user_data: {
          ph: [hashedPhone]
        },
        custom_data: {
          lead_id:         lead.id || '',
          nome:            lead.nome || '',
          empreendimento:  lead.empreendimento || '',
          coluna:          lead.coluna || '',
          corretor:        lead.corretor || '',
          origem:          lead.origem || ''
        }
      }],
      test_event_code: 'TEST12345'  // ← Ativo: aparece no painel "Eventos de Teste" da Meta
    });

    const options = {
      hostname: 'graph.facebook.com',
      path: `/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.events_received > 0 || parsed.fbtrace_id) {
            console.log(`📡 Meta CAPI ✅ Evento "${eventName}" enviado para lead ${lead.nome} | fbtrace: ${parsed.fbtrace_id}`);
          } else {
            console.log(`⚠️ Meta CAPI resposta:`, parsed);
          }
          resolve(parsed);
        } catch(e) {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Erro ao enviar evento para Meta CAPI:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos do CRM
app.use(express.static(__dirname));

const fs = require('fs');

// ── CALLMEBOT WHATSAPP NOTIFICATIONS ─────────────────────────────
const CORRETORES_WHATSAPP = {
  'Flavia':  { phone: '5511920052426', apikey: '9010440' },
  'Antonio': { phone: '5511920000366', apikey: '4277507' },
  'Yasmim':  { phone: '5511965422661', apikey: '7137107' }
};

function sendWhatsAppNotification(corretor, lead) {
  const config = CORRETORES_WHATSAPP[corretor];
  if (!config) return;

  const mensagem = [
    '🏠 *Novo Lead no CRM!*',
    `👤 Nome: ${lead.nome}`,
    `📱 WhatsApp: ${lead.whatsapp || 'Não informado'}`,
    `🏢 Empreendimento: ${lead.empreendimento}`,
    `📍 Origem: ${lead.origem === 'SITE' ? 'Site' : 'Facebook/Instagram'}`,
    `👩‍💼 Corretor: ${corretor}`
  ].join('%0A');

  const url = `https://api.callmebot.com/whatsapp.php?phone=${config.phone}&text=${mensagem}&apikey=${config.apikey}`;

  https.get(url, (res) => {
    console.log(`📲 WhatsApp enviado para ${corretor} (status: ${res.statusCode})`);
  }).on('error', (err) => {
    console.log(`⚠️ Erro ao enviar WhatsApp para ${corretor}:`, err.message);
  });
}

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

  // 📲 Notificação WhatsApp para o corretor atribuído
  sendWhatsAppNotification(assignedCorretor, leadObj);

  return res.status(200).json({
    success: true,
    message: 'Lead recebido e cadastrado no Trello CRM com sucesso!',
    lead: leadObj
  });
});

// ── POST /api/conversao-meta (Disparo manual de evento quando lead muda de coluna) ──
app.post('/api/conversao-meta', async (req, res) => {
  const { lead_id, nome, whatsapp, coluna, empreendimento, corretor, origem } = req.body;

  const eventName = COLUNA_TO_META_EVENT[coluna];

  if (!eventName) {
    return res.json({ success: true, skipped: true, reason: `Coluna "${coluna}" não dispara evento.` });
  }

  const leadData = { id: lead_id, nome, whatsapp, coluna, empreendimento, corretor, origem };

  try {
    const result = await sendMetaConversionEvent(eventName, leadData);
    console.log(`🎯 Conversão Meta enviada: lead=${nome}, coluna=${coluna}, evento=${eventName}`);
    return res.json({ success: true, event: eventName, result });
  } catch (err) {
    console.error('Erro ao enviar conversão Meta:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/leads ──────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  res.json(serverLeads);
});

// ── DELETAR LEAD DO SERVIDOR ──────────────────────────────────
app.delete('/api/leads/:id', (req, res) => {
  const { id } = req.params;
  const before = serverLeads.length;
  serverLeads = serverLeads.filter(l => l.id !== id);
  if (serverLeads.length < before) {
    saveBackupToDisk();
    console.log(`🗑️ Lead ${id} excluído do servidor.`);
    res.json({ success: true, message: 'Lead excluído.' });
  } else {
    res.status(404).json({ success: false, message: 'Lead não encontrado.' });
  }
});

// ── SINCRONIZAR LEADS DO CRM (Frontend → Servidor) ─────────────────────────
app.post('/api/leads/sync', (req, res) => {
  const incoming = req.body;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ success: false, error: 'Payload inválido.' });
  }
  serverLeads = incoming;
  saveBackupToDisk();
  console.log(`🔄 Leads sincronizados: ${serverLeads.length} leads salvos.`);
  res.json({ success: true, count: serverLeads.length });
});

// ── INTEGRAÇÃO GOOGLE SHEETS (POLLING DE PLANILHA) ────────────────────────
const CONFIG_FILE = path.join(__dirname, 'sheet_config.json');
let sheetConfig = { url: '' };

if (fs.existsSync(CONFIG_FILE)) {
  try {
    sheetConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    console.log('📝 Configuração da Planilha carregada:', sheetConfig.url ? 'URL Configurada' : 'Vazia');
  } catch (e) {
    console.error('Erro ao ler sheet_config.json:', e);
  }
}

app.get('/api/config-sheet', (req, res) => {
  res.json(sheetConfig);
});

app.post('/api/config-sheet', (req, res) => {
  const { url } = req.body;
  sheetConfig.url = url || '';
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(sheetConfig, null, 2), 'utf8');
    console.log('📝 Nova URL da planilha salva:', sheetConfig.url);
    
    // Dispara a consulta imediata
    setTimeout(pollGoogleSheet, 1000);
    res.json({ success: true, message: 'Planilha Google Sheets configurada com sucesso!' });
  } catch (e) {
    console.error('Erro ao salvar sheet_config.json:', e);
    res.status(500).json({ error: 'Erro ao salvar a configuração no disco.' });
  }
});

// Função simples de parse de CSV
function parseCSV(text) {
  const lines = [];
  let row = [''];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push('');
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      lines.push(row.map(cell => cell.trim()));
      row = [''];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== '') {
    lines.push(row.map(cell => cell.trim()));
  }
  return lines;
}

// Polling de 20 em 20 segundos da Planilha
async function pollGoogleSheet() {
  if (!sheetConfig.url) return;
  
  try {
    console.log('🔄 Consultando Planilha Google Sheets...');
    const response = await fetch(sheetConfig.url);
    if (!response.ok) throw new Error('Status HTTP ' + response.status);
    
    const csvText = await response.text();
    const rows = parseCSV(csvText);
    if (rows.length < 2) return; // Nenhuma linha ou apenas cabeçalho

    const header = rows[0].map(h => h.toLowerCase());
    
    // Auto-detectar índices das colunas
    let colNomeIdx = header.findIndex(h => h.includes('nome') || h.includes('name') || h.includes('cliente') || h.includes('completo'));
    let colPhoneIdx = header.findIndex(h => h.includes('phone') || h.includes('tel') || h.includes('whats') || h.includes('celular') || h.includes('contato'));
    let colEmailIdx = header.findIndex(h => h.includes('mail') || h.includes('email') || h.includes('e-mail'));
    let colFormIdx = header.findIndex(h => h.includes('form') || h.includes('campanha') || h.includes('ad') || h.includes('produto') || h.includes('empreendimento'));

    // Fallbacks caso não localize
    if (colNomeIdx === -1) colNomeIdx = 1; 
    if (colPhoneIdx === -1) colPhoneIdx = 2;
    if (colEmailIdx === -1) colEmailIdx = 3;
    if (colFormIdx === -1) colFormIdx = 4;

    let newLeadsCount = 0;

    // Iterar pelas linhas de dados
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const nameVal = row[colNomeIdx] || '';
      const phoneVal = row[colPhoneIdx] || '';
      const emailVal = row[colEmailIdx] || '';
      const formVal = row[colFormIdx] || 'Lead Planilha Google';

      if (!nameVal && !phoneVal) continue; // Linha vazia

      // Limpar telefone para comparação robusta
      const cleanPhone = phoneVal.replace(/\D/g, '');
      if (!cleanPhone && !emailVal) continue;

      // Verificar se o lead já existe no CRM
      const exists = serverLeads.some(lead => {
        const leadPhoneClean = (lead.whatsapp || '').replace(/\D/g, '');
        if (cleanPhone && leadPhoneClean === cleanPhone) return true;
        if (emailVal && lead.email && lead.email.toLowerCase() === emailVal.toLowerCase()) return true;
        return false;
      });

      if (!exists) {
        const assignedCorretor = getNextRodizioCorretor();
        const leadObj = {
          id: 'lead-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          nome: nameVal,
          whatsapp: phoneVal,
          email: emailVal,
          dataEntrada: new Date().toISOString().split('T')[0],
          empreendimento: formVal,
          tags: ['LESTE', 'ANUNCIO', 'PRIMEIRA MENSAGEM'],
          customTags: 'Planilha Google',
          lembrete: '',
          ultimaConversa: `[LEAD AUTOMÁTICO VIA PLANILHA GOOGLE]\nCorretor Atribuído: ${assignedCorretor}\nE-mail: ${emailVal}\nImportado em: ${new Date().toLocaleString('pt-BR')}`,
          coluna: 'PRIMEIRA MENSAGEM',
          origem: 'ANUNCIO',
          corretor: assignedCorretor
        };

        serverLeads.unshift(leadObj);
        newLeadsCount++;
        console.log(`📥 Novo lead importado da planilha: ${nameVal} -> ${assignedCorretor}`);
      }
    }

    if (newLeadsCount > 0) {
      saveBackupToDisk();
      console.log(`✅ Sincronização concluída! ${newLeadsCount} novos leads importados.`);
    }
  } catch (err) {
    console.error('Erro ao processar planilha do Google Sheets:', err.message);
  }
}

// Consultar a planilha de 20 em 20 segundos
setInterval(pollGoogleSheet, 20000);

// Dispara uma consulta inicial em 10 segundos
setTimeout(pollGoogleSheet, 10000);


app.listen(PORT, () => {
  console.log(`🚀 Servidor Trello CRM rodando na porta ${PORT}`);
  console.log(`🔗 Webhook pronto em: http://localhost:${PORT}/api/webhook-lead`);
  console.log(`🛡️ Sistema de Backup Permanente Ativo: ${BACKUP_FILE}`);
});
