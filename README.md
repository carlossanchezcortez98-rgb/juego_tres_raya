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
3. En **Authentication → Sign In / Providers**, activa **Allow anonymous sign-ins**.
4. En **Project Settings → API**, copia *Project URL* y *anon public key* en `config.js`.

La anon key es pública por diseño; la seguridad la dan las políticas RLS del esquema. No uses nunca la `service_role` en el navegador.

### Qué se guarda

| Tabla | Contenido |
| --- | --- |
| `players` | Un jugador por navegador (usuario anónimo): alias opcional y marcador acumulado (partidas, victorias, empates, derrotas, puntos). |
| `games` | Una fila por partida terminada: modo (`cpu`/`pvp`), quién empezó, resultado, línea ganadora, tablero final, nº de jugadas y duración. |
| `moves` | Las jugadas de cada partida en orden, para poder repetirla. |

No se guardan partidas abandonadas ni datos personales (email, IP…).

### Reglas

- Juegas siempre con **X**: `X` gana = victoria, `O` gana = derrota. Victoria = 3 puntos, empate = 1.
- Los clientes **no pueden insertar** en `games`/`moves` ni editar contadores: solo la función `save_game` escribe, y reproduce la partida en el servidor a partir de las casillas jugadas, así que el resultado no se puede falsear.
- La máquina es imbatible, por lo que contra ella lo máximo es empatar; las victorias llegan en el modo 2 jugadores.
- La identidad anónima vive en el navegador: si borras sus datos, empiezas como jugador nuevo.

## Notas

La tipografía (Outfit) se carga desde Google Fonts y el cliente de Supabase desde jsDelivr. Sin conexión se usa la fuente del sistema y el juego funciona igual, solo que sin guardar partidas.
