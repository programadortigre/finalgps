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


ssh ubuntu@192.168.1.9
ubuntu23131510@


ssh ubuntu@192.168.0.106
ubuntu23131510@



http://192.168.1.9:8000/





ubuntu 
Ubuntu23131510@

mi  casa
ssh ubuntu@192.168.0.106
ubuntu23131510@

 chmod +x deploy.sh
sudo ./deploy.sh


git reset --hard
git pull origin main


# En la VM
cd ~/finalgps
git pull
sudo docker-compose down
sudo docker-compose up -d --build


docker-compose down -v
docker-compose up -d --build     
docker-compose logs -f gps-                  i


cd ~/finalgps
wget https://download.geofabrik.de/south-america/peru-latest.osm.pbf  

          

mkdir -p osrm_data


sudo docker-compose logs -f gps-osrm