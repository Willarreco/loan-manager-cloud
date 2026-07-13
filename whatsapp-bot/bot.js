import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, 'baileys-session');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sessaoValida() {
    const credsPath = join(SESSION_DIR, 'creds.json');
    if (!existsSync(credsPath)) return false;
    try {
        const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
        return creds.registered === true && creds.serverToken;
    } catch {
        return false;
    }
}

async function main() {
    // Se sessão em cache for inválida, começar do zero
    if (existsSync(SESSION_DIR)) {
        if (sessaoValida()) {
            console.log('📂 Sessão WhatsApp válida encontrada em cache.');
        } else {
            console.log('♻️ Sessão inválida ou incompleta. Removendo e iniciando QR...');
            rmSync(SESSION_DIR, { recursive: true, force: true });
        }
    }
    if (!existsSync(SESSION_DIR)) {
        mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['WA Emprestimo Bot', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' }),
        connectTimeoutMs: 30000
    });

    let qrExibido = false;
    let processado = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !qrExibido) {
            qrExibido = true;
            console.log('\n==================================================');
            console.log('  🔷 ESCANEIE O QR CODE COM O WHATSAPP');
            console.log('  📱 Menu → Dispositivos Conectados');
            console.log('==================================================\n');
            console.log(qr);
            console.log('\n==================================================\n');
            console.log('⏳ Aguardando você escanear o QR code (4 min)...');
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.error('WhatsApp deslogado. Remova a pasta baileys-session e execute novamente.');
                process.exit(1);
            }
            if (!processado) {
                console.error('Conexão fechada inesperadamente. Tentando novamente...');
            }
        }

        if (connection === 'open' && !processado) {
            processado = true;
            if (qrExibido) {
                console.log('\n✅ QR Code escaneado! WhatsApp conectado.');
            } else {
                console.log('\n✅ WhatsApp conectado via sessão salva!');
            }
            await processarPagamentos(sock);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout de 4 minutos
    await delay(240000);
    if (!processado) {
        if (qrExibido) {
            console.error('\n⏰ Tempo esgotado. QR code não escaneado a tempo.');
            console.error('Execute o workflow novamente para tentar de novo.');
        } else {
            console.error('\n⏰ Tempo esgotado. Não foi possível conectar ao WhatsApp.');
            console.error('Verifique se a sessão é válida ou execute novamente.');
        }
        process.exit(1);
    }
}

async function processarPagamentos(sock) {
    const today = new Date().toISOString().split('T')[0];
    console.log(`\n📅 Verificando pagamentos com vencimento em ${today}...\n`);

    const { data: loans, error } = await supabase
        .from('loans')
        .select('id, nome, telefone, total_a_pagar, frequencia, auto_notify, pagamentos!inner(id, data_vencimento, valor, pago, whatsapp_enviado, tipo)')
        .eq('auto_notify', true)
        .eq('pagamentos.data_vencimento', today)
        .eq('pagamentos.pago', false)
        .eq('pagamentos.whatsapp_enviado', false);

    if (error) {
        console.error('Erro ao consultar Supabase:', error.message);
        await sock.logout();
        process.exit(1);
    }

    if (!loans || loans.length === 0) {
        console.log('✅ Nenhum pagamento vencendo hoje com notificação automática ativada.');
        await sock.logout();
        process.exit(0);
    }

    console.log(`📤 Enviando mensagens para ${loans.length} cliente(s)...\n`);

    for (const loan of loans) {
        const telefone = loan.telefone.replace(/\D/g, '');
        const nome = loan.nome.split(' ')[0];
        const duePayments = loan.pagamentos.filter(p =>
            p.data_vencimento === today && !p.pago && !p.whatsapp_enviado
        );

        if (duePayments.length === 0) continue;

        const pagamentoIds = duePayments.map(p => p.id);
        await supabase.from('pagamentos').update({ whatsapp_enviado: true }).in('id', pagamentoIds);

        const message = `Bom dia! Tudo bem?\n\n${nome}, passando para lembrar que hoje vence o seu compromisso de pagamento.\n\nVocê pode realizar o pagamento do valor total da dívida ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros.\n\nCaso tenhamos um acordo diferente, desconsidere esta mensagem e siga as condições previamente acertadas.\n\nQualquer dúvida, estou à disposição. Obrigado!`;

        try {
            const chatId = `${telefone}@s.whatsapp.net`;
            await sock.sendMessage(chatId, { text: message });
            console.log(`✅ Mensagem enviada para ${loan.nome} (${telefone})`);
        } catch (err) {
            console.error(`❌ Erro ao enviar para ${loan.nome}:`, err.message);
        }
    }

    console.log('\n🏁 Processamento concluído!');
    await sock.logout();
    process.exit(0);
}

main();
