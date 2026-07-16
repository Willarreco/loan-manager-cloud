import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WA_API_KEY = process.env.WA_API_KEY;
const WA_SESSION_ID = process.env.WA_SESSION_ID;
const WA_API_BASE = 'https://wa-swagger.pavtech.com.br';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !WA_API_KEY || !WA_SESSION_ID) {
    console.error('Erro: SUPABASE_URL, SUPABASE_SERVICE_KEY, WA_API_KEY e WA_SESSION_ID sao obrigatorios.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function waRequest(method, path, body = null) {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': WA_API_KEY
        }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(WA_API_BASE + path, opts);
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(res.status + ' ' + err.slice(0, 200));
    }
    if (res.status === 204) return null;
    return res.json();
}

async function registrarLog(userId, loanId, nome, telefone, valor, vencimento, mensagem, status, tipoEnvio) {
    try {
        await supabase.from('notificacao_log').insert([{
            user_id: userId,
            loan_id: loanId,
            cliente_nome: nome,
            cliente_telefone: telefone,
            parcela_valor: valor,
            parcela_vencimento: vencimento,
            mensagem: mensagem,
            status: status,
            tipo_envio: tipoEnvio
        }]);
    } catch (e) {
        console.error('Erro ao registrar log:', e.message);
    }
}

async function main() {
    // Verificar se a sessão está conectada
    try {
        const session = await waRequest('GET', '/api/sessions/' + WA_SESSION_ID);
        if (session.status !== 'ready') {
            console.error('Sessao nao esta conectada. Status:', session.status);
            console.error('Inicie a sessao e escaneie o QR pelo painel WhatsApp no sistema.');
            process.exit(1);
        }
        console.log('Sessao WhatsApp conectada:', session.name, '-', session.phone || '');
    } catch (e) {
        console.error('Erro ao verificar sessao:', e.message);
        process.exit(1);
    }

    const today = new Date().toISOString().split('T')[0];
    console.log('');
    console.log('Verificando pagamentos com vencimento em ' + today + '...');

    const { data: loans, error } = await supabase
        .from('loans')
        .select('id, nome, telefone, total_a_pagar, frequencia, auto_notify, user_id, pagamentos!inner(id, data_vencimento, valor, pago, whatsapp_enviado, tipo)')
        .eq('auto_notify', true)
        .eq('pagamentos.data_vencimento', today)
        .eq('pagamentos.pago', false)
        .eq('pagamentos.whatsapp_enviado', false);

    if (error) {
        console.error('Erro Supabase:', error.message);
        process.exit(1);
    }

    if (!loans || loans.length === 0) {
        console.log('Nenhum pagamento vencendo hoje.');
        process.exit(0);
    }

    console.log('Enviando para ' + loans.length + ' cliente(s)...');

    for (const loan of loans) {
        const telefone = loan.telefone.replace(/\D/g, '');
        const nome = loan.nome.split(' ')[0];
        const duePayments = loan.pagamentos.filter(p =>
            p.data_vencimento === today && !p.pago && !p.whatsapp_enviado
        );

        if (duePayments.length === 0) continue;

        const pagamentoIds = duePayments.map(p => p.id);
        await supabase.from('pagamentos').update({ whatsapp_enviado: true }).in('id', pagamentoIds);

        const message = 'Bom dia! Tudo bem?\n\n' + nome + ', passando para lembrar que hoje vence o seu compromisso de pagamento.\n\nVoce pode realizar o pagamento do valor total da divida ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros.\n\nCaso tenhamos um acordo diferente, desconsidere esta mensagem e siga as condicoes previamente acertadas.\n\nQualquer duvida, estou a disposicao. Obrigado!';

        try {
            await waRequest('POST', '/api/sessions/' + WA_SESSION_ID + '/messages/send-text', {
                chatId: telefone + '@c.us',
                text: message
            });
            console.log('Enviado para ' + loan.nome + ' (' + telefone + ')');

            await registrarLog(
                loan.user_id, loan.id, loan.nome, loan.telefone,
                duePayments[0].valor, today, message, 'enviado', 'automático'
            );
        } catch (err) {
            console.error('Erro ao enviar para ' + loan.nome + ': ' + err.message);

            await registrarLog(
                loan.user_id, loan.id, loan.nome, loan.telefone,
                duePayments[0].valor, today, message, 'erro: ' + err.message, 'automático'
            );
        }
    }

    console.log('');
    console.log('Processamento concluido!');
}

main().catch(err => {
    console.error('Erro fatal:', err.message);
    process.exit(1);
});
