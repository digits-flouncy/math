# 수학 탐험대 🧮

초등 3학년 수학 활동 모음입니다. GitHub Pages로 서비스됩니다: https://digits-flouncy.github.io/math/

## 폴더 구조

```
index.html                       메인 페이지 (활동 카드 목록)
3-2/                             3학년 2학기
  01-multiplication/             1단원 곱셈
    animal-legs.html             다리가 몇 개? (돼지와 오리)
  05-fractions/                  5단원 분수
    fraction-pizza.html          분수 탐험 (피자)
    fraction-part-whole.html     개구리 묶음 분수
  06-picture-graphs/             6단원 그림그래프 (준비 중)
docs/
  autism-teaching-guide.md       활동을 만들 때 따르는 교육 가이드
src/                             옛 주소 → 새 주소로 자동 이동하는 페이지만 있음 (지우지 마세요)
```

폴더 이름은 `<학년>-<학기>/<단원 번호 두 자리>-<주제>/` 입니다. 다음 학기는 `4-1/01-.../` 처럼 이어 붙입니다.

## 새 활동 추가하기

1. 단원 폴더(`<학년>-<학기>/<번호>-<주제>/`)에 HTML 파일 하나로 만듭니다. 새 단원이면 폴더를 새로 만듭니다.
2. 경로는 항상 **상대 경로**로 씁니다. 활동 페이지에서 메인으로 가는 링크는 `../../index.html` 입니다.
   (`/`로 시작하는 절대 경로는 Pages 주소 `/math/` 아래에서 깨집니다.)
3. `index.html`에 카드를 하나 추가합니다.
4. 파일을 옮길 때는 옛 위치에 `src/` 안의 파일처럼 자동 이동 페이지를 남겨 둡니다.
