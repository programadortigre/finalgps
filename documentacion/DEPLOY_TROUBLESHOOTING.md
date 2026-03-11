# 🛠️ Solución: Error en deploy.sh

## Problema 1: `#!/bin/bash: not found`

### ¿Por qué pasa?
El archivo `deploy.sh` tiene saltos de línea de **Windows (CRLF)** en lugar de **Linux (LF)**.

Cuando lo subes desde Windows, los saltos de línea quedan como `\r\n` (Windows) en lugar de `\n` (Linux).

### Solución Rápida

Ejecuta esto en tu VM:

```bash
bash fix-deploy.sh
```

Esto:
1. Instala `dos2unix`
2. Convierte `deploy.sh` a formato Linux
3. Lo hace ejecutable

Luego:

```bash
sudo bash deploy.sh
```

---

## Problema 2: `containerd.io: Entra en conflicto: containerd`

### ¿Por qué pasa?
La versión de `docker.io` en los repositorios oficiales de Ubuntu entra en conflicto con `containerd` que ya está instalado.

Esto es común en Ubuntu 22.04+ y en versiones noble.

### Solución ✅

**Ya está arreglado en el nuevo `deploy.sh`**

El script ahora:
1. Elimina versiones antiguas conflictivas
2. Usa el script oficial de Docker: `https://get.docker.com`
3. Instala Docker Compose desde el repositorio oficial
4. Evita conflictos de dependencias

---

## Pasos Completos:

### 1️⃣ En tu VM (Ubuntu):

```bash
cd ~/finalgps
bash fix-deploy.sh
```

### 2️⃣ Luego ejecuta el deploy:

```bash
sudo bash deploy.sh
```

El script preguntará por tu tipo de deploy:
- `1` = Cloudflare Tunnel (tu caso recomendado)
- `2` = Production IP Estática
- `3` = NGROK Testing
- `4` = Local Development

### 3️⃣ Espera a que termine:

El script:
- ✅ Instala Docker correctamente
- ✅ Instala Docker Compose v2.24.0
- ✅ Levanta PostgreSQL, Redis, API, Admin Panel
- ✅ Inicializa la base de datos
- ✅ Muestra URLs de acceso

---

## Verificar que todo está bien:

```bash
sudo docker-compose ps
```

Deberías ver todos los contenedores en estado `Up`:
- `gps-postgres` → Up
- `gps-redis` → Up
- `gps-api` → Up
- `gps-worker` → Up
- `gps-admin` → Up

---

## Si algo sigue fallando:

```bash
# Ver logs
sudo docker-compose logs -f

# Ver logs de un servicio específico
sudo docker-compose logs -f api

# Reiniciar un servicio
sudo docker-compose restart api
```

---

## Notas:

- **No necesitas `apt-get install docker`** → El script oficial de Docker es más limpio
- **No necesitas `apt-get install docker-compose`** → Está desactualizado, usamos v2.24.0 directo
- **Windows → Linux**: Ten cuidado con los saltos de línea en archivos `.sh`
  - VS Code: Click en `CRLF` (abajo a la derecha) → Cambiar a `LF`
  - O usar `dos2unix` en Linux

---

¡Listo! 🚀

