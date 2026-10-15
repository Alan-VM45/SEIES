# SEIES: guía del proyecto

## ¿Qué es SEIES?

SEIES es una aplicación web para registrar y organizar informes semanales de DAI y alumnos, dar seguimiento a la asistencia y facilitar el trabajo de coordinación. Permite guardar borradores, consultar historiales y generar planillas para descargar.

La interfaz está en español y funciona en el navegador. No hay un servidor propio de aplicación: Firebase Authentication administra el inicio de sesión y Cloud Firestore almacena y sincroniza los datos.

## ¿Quiénes lo usan?

- **DAI:** consulta los alumnos asignados a su cuenta, prepara y guarda borradores de informes, envía informes a coordinación y consulta el historial de sus alumnos.
- **Coordinación:** además de la carga y el historial, consulta los informes de todas las cuentas, administra las asignaciones de alumnos, elimina informes y accede a las planillas semanal y mensual.

El rol de coordinación se determina por correo electrónico. La interfaz usa `adminEmails` en la configuración de Firebase y las reglas de Firestore mantienen su propia lista de correos administradores; ambas listas deben coincidir.

## ¿Cómo funciona?

1. El usuario inicia sesión con correo y contraseña mediante Firebase Authentication. Si ya inició sesión, se abre el panel; si no, el panel lo devuelve al acceso.
2. La aplicación carga desde Firestore los datos que corresponden al rol y a las asignaciones del usuario. Las actualizaciones de informes, alumnos y perfiles se reciben en tiempo real.
3. En **Carga**, se redacta un informe semanal para un alumno. Los botones de días, observaciones, ausencias y feriados agregan etiquetas al texto para facilitar la escritura.
4. **Guardar progreso** conserva el borrador en el navegador y, cuando hay conexión y permisos, lo sincroniza con Firestore. También se guarda automáticamente mientras se editan los campos. Los borradores locales se conservan por navegador y cuenta.
5. **Enviar a coordinación** guarda un informe definitivo en Firestore. El informe aparece en la vista semanal de coordinación y alimenta el historial y las estadísticas mensuales.
6. Coordinación asigna cada alumno a una cuenta DAI. La persona asignada puede cargar informes y consultar el historial correspondiente.

### Informes y asistencia

El texto del informe puede incluir los días de lunes a viernes, horarios y marcadores como `[AUSENTE DAI]`, `[AUSENTE ALUMNO]` y `[FERIADO]`. La planilla mensual interpreta el texto para calcular presentes del alumno (PA), presentes de la DAI (PD), estados de asistencia y horas. La cantidad de horas se estima a partir de los horarios escritos; si solo se detecta una hora, el sistema cuenta una hora.

La vista de coordinación muestra por defecto los informes de la semana en curso. La búsqueda permite filtrar por alumno o DAI, y las secciones de archivo permiten descargar informes de semanas y meses anteriores.

### Descargas

- **Word:** la planilla semanal se descarga como `.doc` generado desde una tabla HTML.
- **Excel:** la asistencia mensual se descarga como `.xlsx`.

Las exportaciones utilizan ExcelJS y FileSaver, que se cargan desde CDN en el panel.

## Datos y permisos

Los documentos se guardan bajo esta ruta de Firestore:

```text
artifacts/{appId}/public/data/{coleccion}/{documento}
```

Las colecciones principales son:

| Colección | Contenido |
| --- | --- |
| `reports` | Informes enviados y borradores. Incluye datos como alumno, DAI, escuela, grado, detalle, fecha, correo propietario, estado de borrador y correo DAI asignado. |
| `master_alumnos` | Lista maestra de alumnos y su asignación a una cuenta DAI. |
| `master_dais` | Nombres y datos de referencia de las DAI. |
| `user_profiles` | Nombre de perfil asociado al correo de cada usuario. |

`appId` es el identificador que la aplicación usa para separar su espacio de datos en Firestore; en `firebase-config.js` es distinto de `firebase.appId`, que forma parte de la configuración del SDK web.

Las reglas de [firestore.rules](firestore.rules) permiten acceso administrativo a los correos autorizados y restringen el acceso de una DAI a sus borradores, los informes relacionados con alumnos asignados y los datos permitidos de esos alumnos. La interfaz también oculta opciones por rol, pero los permisos efectivos deben estar protegidos por las reglas de Firestore. Revisa y prueba esas reglas antes de publicar, especialmente si cambias los roles o el modelo de asignaciones.

## Tecnologías

- HTML, CSS y JavaScript sin framework de aplicación.
- Firebase Authentication y Cloud Firestore (SDK web compat cargado desde CDN).
- Tailwind CSS y Lucide para estilos e iconos.
- ExcelJS y FileSaver para las descargas de Excel y Word.
- Firebase Hosting para publicar los archivos estáticos.

El `package.json` declara dependencias de Node, pero no define comandos `scripts` de compilación o pruebas. Las páginas cargan varias bibliotecas desde CDN, por lo que el navegador necesita conexión a Internet para obtenerlas.

## Archivos principales

- [index.html](index.html): pantalla de acceso principal.
- [dashboard.html](dashboard.html): panel de carga, coordinación, alumnos, historial y asistencia mensual.
- [script.js](script.js): autenticación, permisos de interfaz, borradores, informes, sincronización, cálculos y exportaciones.
- [firebase-config.example.js](firebase-config.example.js): plantilla de configuración de Firebase.
- `firebase-config.js`: configuración local requerida por la aplicación; no debe publicarse en Git.
- [firestore.rules](firestore.rules): reglas de acceso a Cloud Firestore.
- [firebase.json](firebase.json): configuración de Firebase Hosting y referencia a las reglas.
- [login.css](login.css) y [style.css](style.css): estilos de las páginas de acceso y del panel.
- `img/`: logotipos y otros recursos gráficos.
- [README.md](README.md): instrucciones existentes de instalación y despliegue.

## Requisitos

- Un proyecto de Firebase con Authentication (correo y contraseña), Cloud Firestore y Firebase Hosting habilitados.
- Node.js 18 o superior y npm para las herramientas de desarrollo y Firebase CLI.
- Un navegador moderno y conexión a Internet para cargar las bibliotecas servidas por CDN.

## Configuración local

1. Clona el repositorio y entra en la carpeta:

   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd SEIES
   ```

2. Crea la configuración local a partir de la plantilla:

   ```bash
   cp firebase-config.example.js firebase-config.js
   ```

   En Windows también puedes copiar el archivo desde el Explorador. Completa `firebase` con la configuración de la aplicación web de Firebase, define `appId` para el espacio de datos de SEIES y agrega en `adminEmails` los correos de coordinación. Crea `firebase-config.js` en la raíz, junto a `index.html`.

3. En Firebase, habilita el proveedor de acceso por correo y contraseña, crea las cuentas de los usuarios y configura Firestore.
4. Revisa la lista de administradores en [firestore.rules](firestore.rules), de modo que coincida con `adminEmails`, y publica las reglas.
5. Inicia un servidor HTTP local desde la carpeta del proyecto:

   ```bash
   npx serve .
   ```

6. Abre la dirección local que indique el servidor. No abras `index.html` directamente mediante `file://`, ya que la autenticación y Firestore requieren un origen HTTP.

## Publicación en Firebase Hosting

1. Instala Firebase CLI e inicia sesión:

   ```bash
   npm install -g firebase-tools
   firebase login
   ```

2. Asocia la carpeta al proyecto de Firebase si todavía no está asociada:

   ```bash
   firebase use --add
   ```

3. Publica el sitio y las reglas:

   ```bash
   firebase deploy --only hosting,firestore:rules
   ```

`firebase.json` publica la carpeta del proyecto y redirige las rutas no encontradas a `index.html`. Verifica que `firebase-config.js` esté configurado para el proyecto correcto y que las reglas publicadas sean las esperadas antes de habilitar el acceso de usuarios.

## Consideraciones de seguridad

- Los informes incluyen datos de alumnos. Comparte el acceso solo con las cuentas autorizadas y revisa periódicamente las asignaciones.
- No subas contraseñas, tokens privados ni `firebase-config.js` al repositorio. La configuración web de Firebase no reemplaza las reglas de seguridad.
- Las reglas actuales contienen correos de coordinación explícitos. Al cambiar esos correos, actualiza las reglas además de `adminEmails` y vuelve a desplegarlas.
- Comprueba las reglas y permisos en un proyecto de prueba antes de modificar el acceso a informes o alumnos.