# Zentrix Keys

O Render hospeda o painel de administração e o endpoint `POST /api/validate`.
O Supabase guarda hashes das chaves, vencimento e vínculo ao aparelho.

1. No Supabase, aplique `supabase/migration.sql` se a migração ainda não estiver presente.
2. Suba esta pasta para um repositório Git e use `render.yaml` em um Blueprint do Render.
3. Defina `SUPABASE_URL` e `SUPABASE_SECRET_KEY` nas variáveis de ambiente do serviço. Use a chave secreta apenas no Render.
4. Abra o endereço do Render e entre com o `ADMIN_TOKEN` gerado no ambiente do serviço. Guarde-o em local privado.
5. Configure o Android Studio com `zentrixLicenseUrl=https://SEU-SERVICO.onrender.com` no `gradle.properties` local ou passe `-PzentrixLicenseUrl=https://SEU-SERVICO.onrender.com` ao compilar.

O APK envia a key e um identificador aleatório de instalação por HTTPS. A primeira validação vincula a key ao aparelho.
O painel pode bloquear a key ou desfazer o vínculo. As chaves completas aparecem apenas ao gerar.
