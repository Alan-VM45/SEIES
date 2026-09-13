# SEIES

Sistema web para la gestión de informes DAI, alumnos y coordinación.

## Requisitos

- Node.js 18 o superior
- Un proyecto de Firebase con Authentication (correo y contraseña) y Cloud Firestore habilitados
- Firebase CLI para desplegar en Firebase Hosting

## Instalación local

1. Clona el repositorio:

   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd SEIES
   ```

2. Instala las dependencias del proyecto:

   ```bash
   npm install
   ```

3. Abre `index.html` mediante un servidor local. Por ejemplo:

   ```bash
   npx serve .
   ```

   No se recomienda abrir el archivo directamente con `file://`, porque Firebase Authentication y algunas funciones del navegador requieren un origen HTTP.

## Configuración de Firebase

La configuración web local se encuentra en `firebase-config.js`, un archivo excluido de Git. Copia `firebase-config.example.js` como `firebase-config.js`, completa sus valores y actualiza el proyecto asociado en `.firebaserc`.

La clave `apiKey` de Firebase para aplicaciones web no es una contraseña. El control de acceso debe mantenerse en Firebase Authentication y en las reglas de seguridad de Cloud Firestore; nunca publiques contraseñas, tokens privados o archivos `.env`.

Los correos con permisos de coordinación se configuran en `adminEmails` dentro de `firebase-config.js`.

## Despliegue en Firebase Hosting

1. Instala o actualiza Firebase CLI:

   ```bash
   npm install -g firebase-tools
   ```

2. Inicia sesión:

   ```bash
   firebase login
   ```

3. Comprueba el proyecto configurado:

   ```bash
   firebase use
   ```

4. Publica la aplicación:

   ```bash
   firebase deploy --only hosting
   ```

## Estructura principal

- `index.html`: pantalla de acceso.
- `dashboard.html`: panel principal de trabajo.
- `script.js`: autenticación, persistencia y lógica de la aplicación.
- `login.css` y `style.css`: estilos de acceso y del panel.
- `firebase.json` y `.firebaserc`: configuración de Firebase Hosting.
- `img/`: recursos gráficos de la aplicación.

## Seguridad antes de publicar

- Verifica las reglas de Cloud Firestore en la consola de Firebase.
- Confirma que todos los usuarios autorizados existan en Firebase Authentication.
- Revisa que los correos de `ADMIN_EMAILS` sean los correctos.
- No subas `node_modules`, logs, credenciales ni archivos `.env`.