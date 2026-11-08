export const agentCharacters = {
  xiaotu: {
    id: 'xiaotu',
    name: '江小图',
    title: '空间向导',
    illustration: '/assets/jiang-xiaotu-full.png',
    portrait: '/assets/jiang-xiaotu-full.png',
    description: '江小图身穿绿色开衫和米色长裤，手捧一张展开的馆内地图',
    greeting: '要去哪个阅览室？我也可以帮你找书或整理馆内反馈。',
  },
  xiaoshu: {
    id: 'xiaoshu',
    name: '江小书',
    title: '阅读向导',
    illustration: '/assets/jiang-xiaoshu-full.png',
    portrait: '/assets/jiang-xiaoshu.png',
    description: '江小书戴着圆眼镜和书页发夹，站着捧读一本书',
    greeting: '想找一本书、选个座位，还是反馈馆内问题？',
  },
};

export function characterAvatar(character) {
  return `<span class="agent-avatar agent-avatar--${character.id}" style="background-image:url('${character.portrait}')" aria-hidden="true"></span>`;
}
