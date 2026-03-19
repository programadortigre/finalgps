# App Móvil - Tracking GPS

Para compilar el APK de producción y dárselo a los trabajadores:

1. Modificar IP Destino (Opcional):
En `/lib/services/api_service.dart` puedes modificar los 'kServerPresets' para pre-cargar la IP de tu VPS allí o dejar que el vendedor lo ingrese manualmente al iniciar sesión.

2. Obtener Dependencias
\`\`\`bash
flutter clean
flutter pub get  
\`\`\`

3. Compilar APK Release
\`\`\`bash
flutter build apk --release
\`\`\`

4. Dónde encontrarlo
El APK generado estará listo para instalarse en Android en:
`build/app/outputs/flutter-apk/app-release.apk`
