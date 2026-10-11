# Chrome Web Store — material de publicação

## Nome
Nexo — Assistente de engajamento no LinkedIn

## Resumo (até 132 caracteres)
Responda comentários e DMs com IA, curta e comente com um clique e bata suas metas diárias de engajamento.

## Descrição
O Nexo é o seu assistente de engajamento no LinkedIn.

• Caixa de entrada: comentários sem resposta nos seus posts e DMs não lidas num só lugar
• Respostas com IA (Claude) no seu tom de voz. Você escolhe, edita e envia
• Curtir e comentar com um clique, com metas diárias de engajamento
• Salve perfis em 1 clique, direto da página do perfil ou de um post
• Pipeline visual (Novo → Contatado → Conversando → Reunião → Cliente)
• Notas, tags, histórico de interações e lembretes de follow-up
• Templates de DM e comentário com variáveis ({firstName}, {company}…)
• Sugestões de comentários e respostas com IA (Claude), no seu tom de voz
• Enriquecimento com Exa: resumo da pessoa, temas e dados da empresa, com fontes (opcional)
• Equipe: sincronize o funil com seu time num servidor próprio
• Exportação CSV

Você no controle: o Nexo nunca envia nada sozinho. Ele prepara o texto e você revisa e clica em Enviar.

Privacidade: os dados ficam no seu navegador ou no servidor da sua empresa. Nada vai para servidores do desenvolvedor.

## Categoria
Produtividade (Productivity)

## Finalidade única (single purpose)
Ajudar o usuário a engajar no LinkedIn (responder comentários e mensagens, comentar e curtir) com rascunhos de IA que ele revisa e envia, e organizar os relacionamentos que surgem desse engajamento.

## Justificativa das permissões
| Permissão | Justificativa |
|---|---|
| `storage` | Guardar contatos, notas, templates e configurações localmente. |
| `sidePanel` | Exibir o CRM (lista, pipeline, follow-ups) no painel lateral. |
| `alarms` | Verificar follow-ups vencidos (de hora em hora) e sincronizar com o servidor da equipe (a cada minuto). |
| `notifications` | Avisar sobre follow-ups do dia. |
| `https://www.linkedin.com/*` | Adicionar botões (salvar contato, templates, IA) às páginas de perfil, feed e mensagens, e ler os dados do perfil que o usuário decide salvar. |
| `https://api.anthropic.com/*` | Gerar sugestões de texto com IA quando o usuário clica em um botão de IA, com a chave do próprio usuário. |
| `https://api.exa.ai/*` | Pesquisar informações públicas do contato e da empresa quando o usuário clica em *Enriquecer*, com a chave do próprio usuário. |
| `optional_host_permissions` (`https://*/*`) | Pedida em tempo de execução **só para o endereço do servidor da equipe** que o usuário informar. O endereço muda de empresa para empresa, por isso não pode ser fixo. |
| Código remoto | Não usa. Todo o código está no pacote. |

## Divulgação de dados (formulário "Privacy practices")
- Coleta: **informações de identificação pessoal** (nome, e-mail de contatos salvos pelo usuário), **conteúdo do site** (texto de posts e conversas, só quando o usuário aciona a IA).
- Certificações a marcar: não vende dados a terceiros; não usa nem transfere dados para fins não relacionados à finalidade única; não usa dados para avaliar crédito.
- URL da política de privacidade: https://github.com/juliopessan/Nexo/blob/main/PRIVACY.md

## Recursos visuais pendentes
- [ ] Ícone 128×128 definitivo (o atual é provisório)
- [ ] 1 a 5 capturas de tela 1280×800: perfil com barra do Nexo, feed com botões, pipeline, sugestões de IA, aba Config
- [ ] Bloco promocional 440×280

## Riscos de revisão
- Extensões que automatizam ações no LinkedIn costumam ser rejeitadas ou denunciadas. Por isso a descrição e o vídeo de demonstração devem mostrar que **toda ação exige um clique** do usuário.
- "LinkedIn" no nome pode gerar contestação de marca. Alternativa: "Nexo — CRM para sua rede profissional".
