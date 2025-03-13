# Turborepo starter

This Turborepo starter is maintained by the Turborepo core team.

## Using this example

Run the following command:

```sh
npx create-turbo@latest
```

## What's inside?

This Turborepo includes the following packages/apps:

### Apps and Packages

- `docs`: a [Next.js](https://nextjs.org/) app
- `web`: another [Next.js](https://nextjs.org/) app
- `@repo/ui`: a stub React component library shared by both `web` and `docs` applications
- `@repo/eslint-config`: `eslint` configurations (includes `eslint-config-next` and `eslint-config-prettier`)
- `@repo/typescript-config`: `tsconfig.json`s used throughout the monorepo

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This Turborepo has some additional tools already setup for you:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting

### Build

To build all apps and packages, run the following command:

```
cd my-turborepo
pnpm build
```

### Develop

To develop all apps and packages, run the following command:

```
cd my-turborepo
pnpm dev
```

### Remote Caching

> [!TIP]
> Vercel Remote Cache is free for all plans. Get started today at [vercel.com](https://vercel.com/signup?/signup?utm_source=remote-cache-sdk&utm_campaign=free_remote_cache).

Turborepo can use a technique known as [Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching) to share cache artifacts across machines, enabling you to share build caches with your team and CI/CD pipelines.

By default, Turborepo will cache locally. To enable Remote Caching you will need an account with Vercel. If you don't have an account you can [create one](https://vercel.com/signup?utm_source=turborepo-examples), then enter the following commands:

```
cd my-turborepo
npx turbo login
```

This will authenticate the Turborepo CLI with your [Vercel account](https://vercel.com/docs/concepts/personal-accounts/overview).

Next, you can link your Turborepo to your Remote Cache by running the following command from the root of your Turborepo:

```
npx turbo link
```

## Useful Links

Learn more about the power of Turborepo:

- [Tasks](https://turbo.build/repo/docs/core-concepts/monorepos/running-tasks)
- [Caching](https://turbo.build/repo/docs/core-concepts/caching)
- [Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching)
- [Filtering](https://turbo.build/repo/docs/core-concepts/monorepos/filtering)
- [Configuration Options](https://turbo.build/repo/docs/reference/configuration)
- [CLI Usage](https://turbo.build/repo/docs/reference/command-line-reference)

## Configuration du Serveur

### Mode de Développement Local (par défaut)

Par défaut, le client se connecte au serveur en local à l'adresse `http://localhost:2567`. Cette configuration est définie dans le fichier `apps/client/.env`.

### Mode VPS avec IP Externe

Pour connecter le client à un serveur distant :

1. Modifiez le fichier `apps/client/.env` en commentant les lignes de serveur local et en décommentant les lignes avec l'adresse IP du VPS :
   ```
   # Configuration du serveur local (par défaut)
   # VITE_SERVER_URL=http://localhost:2567
   # VITE_COLYSEUS_URL=ws://localhost:2567

   # Pour utiliser le serveur distant, décommentez ces lignes
   VITE_SERVER_URL=http://57.128.190.227:2567
   VITE_COLYSEUS_URL=ws://57.128.190.227:2567
   ```

2. Si vous déployez pour la production, utilisez plutôt le fichier `apps/client/.env.production` qui est déjà configuré avec l'adresse IP du VPS.

### Exécution avec Arguments de Ligne de Commande

Vous pouvez maintenant exécuter le client et le serveur en mode production directement à l'aide d'arguments de ligne de commande, sans avoir à modifier manuellement les fichiers `.env` :

#### Client en mode développement (localhost)
```
pnpm run client
```

#### Client en mode production (utilise l'IP externe)
```
pnpm run client:prod
```

#### Serveur en mode développement
```
pnpm run server
```

#### Serveur en mode production
```
pnpm run server:prod
```

#### Exécuter client et serveur en mode production simultanément
```
pnpm run prod
```

### Déploiement en Production

Lorsque vous construisez pour la production avec `npm run build`, Vite utilisera automatiquement les variables d'environnement définies dans `.env.production`.

Commande pour construire le client en mode production :
```
cd pvpstrat-io/apps/client
npm run build
```
