/*
 * The only things StreamWindows needs from a client mod. Vencord and
 * BetterDiscord each implement this; src/core/streamwindows.ts knows nothing
 * about either.
 *
 * Deliberately tiny: the plugin declares no webpack patches, so all it needs is
 * read-only module lookup plus a place to hang a context-menu item.
 */
export interface Platform {
    /** module exposing all of these own properties (Vencord findByProps / BD getByKeys) */
    getByProps(...props: string[]): any;
    /** module whose source contains all of these strings (Vencord findByCode / BD Filters.byStrings) */
    getByCode(...code: string[]): any;
    /** Flux store by its registered name */
    getStore(name: string): any;
    /** first module matching an arbitrary predicate */
    find(filter: (m: any) => boolean): any;
    log(...args: any[]): void;
}

/** A context-menu row, rendered by whichever adapter is hosting us. */
export interface MenuEntry {
    id: string;
    label: string;
    action: () => void;
    disabled?: boolean;
    danger?: boolean;
}
