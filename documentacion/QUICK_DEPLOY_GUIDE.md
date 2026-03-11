# 🚀 Guía Rápida de Deploy

## Desarrollo Local (Windows/Mac/Linux)

```bash
# Primera vez
cp .env.example .env
nano .env   # Edita con valores locales:
# DEPLOY_MODE=local
# API_DOMAIN=localhost
# POSTGRES_PASSWORD=algo-simple

# Inicia servicios
docker-compose up -d --build

# Admin Panel
http://localhost
```

---

## Producción (VM Ubuntu)

### PASO 1: En tu PC, prepara el código

```bash
# Edita admin-panel, api, worker, etc
# Luego push:
git add .
git commit -m "Ready for production deploy"
git push origin main
```

### PASO 2: En la VM Ubuntu

```bash
# Conecta a tu VM
ssh ubuntu@tu-vm-ip

# Entra a la carpeta
cd finalgps

# Trae los últimos cambios (SIN el .env real)
git pull

# UNA ÚNICA VEZ - Copia el template
cp .env.example .env

# Edita con valores de producción
nano .env

# Edita estos valores:
# DEPLOY_MODE=cloudflare        (o production, ngrok, etc)
# API_DOMAIN=miempresa.com      (tu dominio)
# POSTGRES_PASSWORD=algo-mega-seguro
# JWT_SECRET=algo-mega-seguro-tambien
# NODE_ENV=production
```

### PASO 3: Deploy

```bash
# Levanta todos los servicios
sudo bash deploy-clean.sh

# El script:
# ✅ Instala Docker (si no existe)
# ✅ Instala Docker Compose (si no existe)
# ✅ Levanta PostgreSQL, Redis, API, Admin, Worker
# ✅ Muestra URLs finales

# Ver logs
sudo docker-compose logs -f

# Detener
sudo docker-compose down
```

---

## 🔄 Actualizaciones Posteriores

```bash
# En tu PC
git add .
git commit -m "Update feature X"
git push origin main

# En la VM
cd ~/finalgps
git pull
sudo docker-compose down
sudo docker-compose up -d --build

# El .env NO cambia (ya está en la VM)
```

---

## ⚠️ Variables Importantes

| Variable | Desarrollo | Producción |
|----------|-----------|------------|
| `DEPLOY_MODE` | `local` | `cloudflare` o `production` |
| `API_DOMAIN` | `localhost` | `miempresa.com` |
| `API_PORT` | `3000` | `443` |
| `NODE_ENV` | `development` | `production` |
| `POSTGRES_PASSWORD` | Simple | **Compleja y segura** |
| `JWT_SECRET` | Simple | **Compleja y segura** |

---

## 🆘 Troubleshooting

### "Error: No existe .env"
```bash
cp .env.example .env
nano .env  # Edita valores
```

### "Puerto en uso"
```bash
sudo docker-compose down
sudo docker-compose up -d --build
```

### "Servicios no responden"
```bash
sudo docker-compose logs api
sudo docker-compose logs postgres
```

### "CLOUDFLARE TUNNEL no conecta"
```bash
# En otra terminal
warp-cli tunnel run

# Verifica que esté ejecutándose
warp-cli tunnel list
```

---

## 📁 Estructura de Archivos

```
finalgps/
├── .env              ← TU archivo (no en Git) 🔒
├── .env.example      ← Template (SÍ en Git) ✅
├── .gitignore        ← Ignora .env ✅
├── deploy-clean.sh   ← Script de deploy ✅
├── docker-compose.yml
├── api/
├── admin-panel/
├── worker/
├── database/
└── mobile/
```

---

¡Listo para deployar! 🚀
