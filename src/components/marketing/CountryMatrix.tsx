/**
 * The country matrix, filling itself in.
 *
 * The landing page's signature element, and the reason it is this rather than a
 * screenshot of a dashboard: the matrix is the document every organising
 * committee already has, usually as a spreadsheet tab somebody guards. Showing
 * it says what the product is before the headline has been read.
 *
 * It is real. These are the committees and the countries a mid-sized Indian
 * conference actually runs, in the ISO codes an allocation sheet uses — with
 * AIPPM in party abbreviations and IPC in wire-service ones, because a real
 * matrix is not fourteen columns of tidy alpha-3. The filled cells are seats
 * already allocated; the empty ones are the work left. UNSC is nearly full
 * because the popular committee always fills first and UNCTAD trails because it
 * always does.
 *
 * ## Why it is wider than the screen
 *
 * The version this replaced was five committees in a column beside the
 * headline: a thumbnail of a document rather than the document. Fourteen
 * committees do not fit on a monitor, and they have never fitted on one for the
 * person this page is written for. So the grid starts flush with the headline,
 * runs off the right-hand edge, and dissolves there. The clipping is the
 * argument.
 *
 * Server-rendered with no JavaScript at all. The animation is a CSS keyframe
 * with a per-cell delay — see `.matrix-cell` in tokens.css, which also removes
 * it outright under `prefers-reduced-motion` rather than merely shortening it.
 */

interface Committee {
  code: string
  /**
   * The seats, in the codes the allocation sheet is written in.
   */
  seats: string[]
  /**
   * One character per seat: `#` allocated, `.` open.
   *
   * A mask rather than an array of booleans, so the shape of each committee's
   * progress is legible in the source. `[true, true, false, true]` is a wall;
   * `##.#` is a picture. Asserted against `seats.length` below, so the two
   * cannot drift apart silently.
   */
  filled: string
}

const COMMITTEES: Committee[] = [
  {
    code: 'UNSC',
    seats: ['USA', 'GBR', 'FRA', 'RUS', 'CHN', 'IND', 'BRA', 'NGA', 'KEN', 'JPN', 'KOR', 'SVN'],
    filled: '####.######.',
  },
  {
    code: 'DISEC',
    seats: ['PAK', 'IRN', 'PRK', 'ISR', 'EGY', 'TUR', 'DEU', 'AUS', 'CAN', 'ARG', 'ZAF', 'UKR'],
    filled: '###.###.####',
  },
  {
    code: 'UNHRC',
    seats: ['ARG', 'BGD', 'BEL', 'BEN', 'BOL', 'BGR', 'CHL', 'CRI', 'CIV', 'CUB'],
    filled: '##.##.####',
  },
  {
    code: 'WHO',
    seats: ['AUS', 'AUT', 'CAN', 'COL', 'DNK', 'EGY', 'ETH', 'ISL', 'IRL', 'ISR', 'ITA'],
    filled: '###.#..###.',
  },
  {
    code: 'AIPPM',
    seats: ['BJP', 'INC', 'AAP', 'TMC', 'DMK', 'SP', 'NCP', 'JDU', 'RJD', 'SS', 'BJD'],
    filled: '####.###..#',
  },
  {
    code: 'ECOSOC',
    seats: ['AGO', 'BHR', 'BWA', 'CMR', 'TCD', 'COG', 'GAB', 'GTM', 'HND', 'JAM'],
    filled: '##..#.#...',
  },
  {
    code: 'UNEP',
    seats: ['BRA', 'IDN', 'COD', 'NOR', 'SWE', 'FIN', 'NZL', 'CHL', 'PNG', 'FJI', 'TUV'],
    filled: '##.#..#.#..',
  },
  {
    code: 'IAEA',
    seats: ['IRN', 'PRK', 'JPN', 'FRA', 'RUS', 'USA', 'IND', 'PAK', 'CHN'],
    filled: '#######..',
  },
  {
    code: 'UNODC',
    seats: ['MEX', 'COL', 'PER', 'AFG', 'MMR', 'THA', 'VNM', 'PHL', 'LAO'],
    filled: '##.#..#..',
  },
  {
    code: 'UNCSW',
    seats: ['SWE', 'NOR', 'RWA', 'NPL', 'ESP', 'MAR', 'JOR', 'CAN', 'ZAF', 'NZL'],
    filled: '###.#.#...',
  },
  {
    code: 'SOCHUM',
    seats: ['SYR', 'MMR', 'VEN', 'HTI', 'SDN', 'SOM', 'YEM', 'LBY', 'MLI', 'NER', 'TCD', 'ERI'],
    filled: '####.##.#...',
  },
  {
    code: 'IPC',
    seats: ['PTI', 'ANI', 'AFP', 'RTR', 'BBC', 'CNN', 'AJZ', 'NYT'],
    filled: '#####...',
  },
  {
    code: 'LEGAL',
    seats: ['NLD', 'BEL', 'CHE', 'AUT', 'PRT', 'GRC', 'POL', 'CZE', 'HUN', 'ROU'],
    filled: '##.#......',
  },
  {
    code: 'UNCTAD',
    seats: ['CHN', 'IND', 'BRA', 'ZAF', 'RUS', 'EGY', 'TUR', 'IDN'],
    filled: '#.#.....',
  },
]

/* A mask that is a character short leaves a column of seats rendering as open
   when they are not. Cheap to assert at module scope, and it runs at build. */
for (const committee of COMMITTEES) {
  if (committee.filled.length !== committee.seats.length) {
    throw new Error(
      `${committee.code}: ${committee.filled.length} mask characters for ${committee.seats.length} seats`,
    )
  }
}

const TOTAL_SEATS = COMMITTEES.reduce((total, committee) => total + committee.seats.length, 0)
const ALLOCATED_SEATS = COMMITTEES.reduce(
  (total, committee) => total + [...committee.filled].filter((mark) => mark === '#').length,
  0,
)

function allocatedIn(committee: Committee): number {
  return [...committee.filled].filter((mark) => mark === '#').length
}

/**
 * The band: a labelled header rail, then the grid.
 *
 * The rail is not a caption. A caption under an illustration is the thing
 * nobody reads; this is the header of a document — what it is, how it gets in,
 * and the count that an organising committee looks at first.
 */
export function CountryMatrixBand() {
  return (
    <section className="ground-paper border-y border-hairline">
      <div className="py-10 md:py-14">
        <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-5 md:flex-row md:items-end md:justify-between md:gap-12 md:px-8">
          <div className="max-w-prose">
            <p className="font-mono text-label uppercase text-on-ground-muted">
              The country matrix · mid-allocation
            </p>
            <p className="mt-3 text-body text-on-ground">
              Import it as a column per committee or a row per seat. Seat capacity is enforced as you
              allocate, so two delegates cannot hold the same country.
            </p>
          </div>

          <dl className="flex shrink-0 items-end gap-8 font-mono">
            <div>
              <dt className="text-label uppercase text-on-ground-muted">Allocated</dt>
              <dd className="mt-1 text-h1 tabular-nums text-accent-on-ground">
                {ALLOCATED_SEATS}
                <span className="text-h3 text-on-ground-muted">/{TOTAL_SEATS}</span>
              </dd>
            </div>
            <div>
              <dt className="text-label uppercase text-on-ground-muted">Committees</dt>
              <dd className="mt-1 text-h1 tabular-nums text-on-ground">{COMMITTEES.length}</dd>
            </div>
          </dl>
        </div>

        {/*
          Hidden from assistive technology, with one sentence in its place.

          A hundred and forty-three country codes read aloud is not an
          illustration, it is an obstruction — and the paragraph above it
          already carries everything this picture carries.
        */}
        <p className="sr-only">
          An illustration of a country matrix: fourteen committees, {TOTAL_SEATS} seats between them,
          {' '}
          {ALLOCATED_SEATS} of them allocated.
        </p>

        <div className="matrix-band mt-8" aria-hidden>
          <div className="mx-auto w-full max-w-page pl-5 md:pl-8">
            <div className="matrix-grid">
              {COMMITTEES.map((committee, columnIndex) => (
                <div key={committee.code} className="flex flex-col gap-1">
                  <div className="mb-2 border-b border-hairline pb-2">
                    <p className="truncate font-mono text-label uppercase text-on-ground">
                      {committee.code}
                    </p>
                    <p className="mt-1 font-mono text-label tabular-nums text-on-ground-muted">
                      {allocatedIn(committee)}/{committee.seats.length}
                    </p>
                  </div>

                  {committee.seats.map((seat, seatIndex) => (
                    <div
                      key={`${committee.code}-${seat}-${seatIndex}`}
                      data-filled={committee.filled[seatIndex] === '#' ? 'true' : 'false'}
                      className="matrix-cell h-6 text-[11px] md:h-7"
                      /*
                        The stagger runs down each column and then across, so the
                        grid fills the way an allocation session does — one
                        committee settled before the next is opened — rather than
                        sparkling at random. An inline style rather than a
                        hundred and forty utility classes: `style-src-attr`
                        permits the attribute, and a class per delay would be a
                        hundred and forty rules in the stylesheet for one
                        element.
                      */
                      style={{ animationDelay: `${100 + columnIndex * 42 + seatIndex * 20}ms` }}
                    >
                      {seat}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
