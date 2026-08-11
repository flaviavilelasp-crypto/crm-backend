
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
