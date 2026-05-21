# GitHub Readme Stats Action

Generate [GitHub Readme Stats](https://github.com/stats-organization/github-readme-stats) cards in your GitHub Actions workflow, commit them to your profile repository, and embed them directly from there.

## Quick start

```yaml
name: Update README cards

on:
  schedule:
    - cron: "0 0 * * *" # Runs once daily at midnight
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest

    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v6

      - name: Generate stats card
        uses: stats-organization/github-readme-stats-action@v2
        with:
          card: stats
          options: username=${{ github.repository_owner }}&show_icons=true
          path: profile/stats.svg
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate top languages card
        uses: stats-organization/github-readme-stats-action@v2
        with:
          card: top-langs
          options: username=${{ github.repository_owner }}&layout=compact&langs_count=6
          path: profile/top-langs.svg
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate pin card
        uses: stats-organization/github-readme-stats-action@v2
        with:
          card: pin
          options: username=stats-organization&repo=github-readme-stats
          path: profile/pin-stats-organization-github-readme-stats.svg
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Commit cards
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add profile/*.svg
          git commit -m "Update README cards" || exit 0
          git push
```

Then embed from your profile README:

```md
![Stats](./profile/stats.svg)
![Top Languages](./profile/top-langs.svg)
![Pinned](./profile/pin-stats-organization-github-readme-stats.svg)
```

## Deployment options

This action is a recommended deployment option. You can also use [our public GitHub-Stats-Extended instance](https://github.com/stats-organization/github-stats-extended#quick-start) or [deploy one yourself](https://github.com/stats-organization/github-stats-extended/blob/master/docs/deploy.md#self-hosted-on-vercel).

## Inputs

- `card` (required): Card type. Supported: `stats`, `top-langs`, `pin`, `wakatime`, `gist`.
- `options`: Card options as a query string (`key=value&...`) or JSON. If `username` is omitted, the action uses the repository owner.
- `path`: Output path for the SVG file. Defaults to `profile/<card>.svg`.
- `token`: GitHub token (PAT or `GITHUB_TOKEN`). For private repo stats, use a [PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) with `repo` and `read:user` scopes. For any gist, use a PAT with `gist` scope.
- `core_version`: Version of [GitHub Stats Extended](https://github.com/stats-organization/github-stats-extended) to use internally. When omitted, the action uses the latest 2.x.x version.

## Examples

Stats example:

```yaml
with:
  card: stats
  options: username=octocat&show_icons=true&hide_rank=true&bg_color=0D1117
  token: ${{ secrets.GITHUB_TOKEN }}
```

Top languages example:

```yaml
with:
  card: top-langs
  options: username=octocat&layout=compact&langs_count=6
  token: ${{ secrets.GITHUB_TOKEN }}
```

WakaTime example:

```yaml
with:
  card: wakatime
  options: username=octocat&layout=compact
  token: ${{ secrets.GITHUB_TOKEN }}
```

Gist example:

```yaml
with:
  card: gist
  options: id=0123456789abcdef
  token: ${{ secrets.PAT }}
```

JSON options example:

```yaml
with:
  card: stats
  options: '{"username":"octocat","show_icons":true,"hide_rank":true}'
  token: ${{ secrets.GITHUB_TOKEN }}
```

Version-pinned example:

```yaml
with:
  card: stats
  options: username=octocat&show_icons=true
  core_version: 2.1.2
  token: ${{ secrets.GITHUB_TOKEN }}
```

## Notes

- This action uses the same renderers and fetchers as [github-stats-extended](https://github.com/stats-organization/github-stats-extended).
