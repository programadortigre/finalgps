# 1. Descarga código
cd ~/finalgps
git pull

# 2. Copia template (única vez)
cp .env.example .env

# 3. Edita con valores de PRODUCCIÓN
nano .env
# DEPLOY_MODE=cloudflare
# API_DOMAIN=miempresa.com
# POSTGRES_PASSWORD=algo-seguro

# 4. Deploy (¡nada más!)
sudo bash deploy.sh