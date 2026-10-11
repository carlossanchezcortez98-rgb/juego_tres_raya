# Tres en Raya

Juego clásico de tres en raya para el navegador, hecho con HTML, CSS y JavaScript puro (sin dependencias ni build).

## Cómo jugar

Abre `index.html` con doble clic en cualquier navegador moderno. No hace falta instalar nada.

## Características

- **Dos modos**: contra la máquina o 2 jugadores en el mismo dispositivo.
- **Máquina imbatible**: usa el algoritmo minimax, así que como mucho puedes empatarla.
- **Marcador** de victorias de X, de O y empates.
- **Quién empieza** se alterna en cada partida.
- **Interfaz cuidada**: fondo animado, tablero de cristal, marcas dibujadas con trazo animado, línea ganadora luminosa y confeti al ganar.
- **Teclado**: teclas `1`–`9` juegan una casilla, las flechas mueven el foco y `N` empieza otra partida.
- **Sonido y vibración** opcionales (botón de altavoz; desactivados por defecto, se recuerda la elección).
- **Colores** pensados para distinguirse bien: X aguamarina frente a O ámbar. La última jugada se resalta con un anillo.
- **Adaptable** a móvil y respeta la preferencia de "reducir movimiento".

- **Base de datos opcional (Supabase)**: guarda tus partidas, perfil con alias, historial con repetición y ranking global. Sin configurar, el juego funciona igual pero sin guardar nada.

## Estructura

| Archivo | Contenido |
| --- | --- |
| `index.html` | Estructura de la página |
| `styles.css` | Estilos y animaciones |
| `script.js` | Lógica del juego, IA, confeti y repetición |
| `db.js` | Acceso a Supabase (sesión anónima, guardar partida, historial, ranking) |
| `profile.js` | Diálogo de perfil: alias, estadísticas, historial y ranking |
| `config.js` | URL y anon key de tu proyecto de Supabase |
| `supabase/schema.sql` | Tablas, seguridad (RLS) y función `save_game` |

## Base de datos (Supabase)

### Puesta en marcha

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega y ejecuta `supabase/schema.sql`.
3. En **Project Settings → API**, copia *Project URL* y *anon / publishable key* en `config.js`.

No hay cuentas ni inicio de sesión: no hace falta activar ningún proveedor de Auth. La anon key es pública por diseño; no uses nunca la `service_role` ni la secret key en el navegador.

### Qué se guarda

| Tabla | Contenido |
| --- | --- |
| `players` | Un jugador por navegador: alias opcional y marcador acumulado (partidas, victorias, empates, derrotas, puntos). |
| `games` | Una fila por partida terminada: modo (`cpu`/`pvp`), quién empezó, resultado, línea ganadora, tablero final, nº de jugadas y duración. |
| `moves` | Las jugadas de cada partida en orden, para poder repetirla. |

No se guardan partidas abandonadas ni datos personales (email, IP…).

### Cómo funciona la identidad y la seguridad

- Cada navegador genera un id aleatorio (uuid) y lo guarda en `localStorage`. Ese id es la "llave" de su jugador: nadie más lo conoce, porque el ranking nunca lo devuelve.
- Las tablas no son accesibles desde el cliente (RLS activado y sin políticas). Todo pasa por funciones del servidor: `ensure_player`, `set_alias`, `save_game`, `get_history`, `get_moves` y `get_leaderboard`.
- `save_game` reproduce la partida en el servidor a partir de las casillas jugadas, así que no se puede falsear un resultado inconsistente con las jugadas.
- Limitación asumida: al no haber cuentas, cualquiera con la anon key podría crear jugadores y enviar partidas "legales" inventadas. Es un juego casual; si el ranking importara, habría que añadir Auth.
- Si borras los datos del navegador, empiezas como jugador nuevo.

### Reglas

- Juegas siempre con **X**: `X` gana = victoria, `O` gana = derrota. Victoria = 3 puntos, empate = 1.
- La máquina es imbatible, por lo que contra ella lo máximo es empatar; las victorias llegan en el modo 2 jugadores.

## Notas

La tipografía (Outfit) se carga desde Google Fonts y el cliente de Supabase desde jsDelivr. Sin conexión se usa la fuente del sistema y el juego funciona igual, solo que sin guardar partidas.
