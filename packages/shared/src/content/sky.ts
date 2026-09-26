// Things floating in the sky. Click one and it says its line in a speech bubble. Add an entry
// here and drop the image in packages/client/public/assets/textures/sky; the client handles the rest.
export interface SkyContent {
  id: string;
  image: string;
  line: string;
}

export const SKY_OBJECTS: SkyContent[] = [
  {
    id: "moon",
    image: "/assets/textures/sky/moon.png",
    line: "Zelda and Mario games are peak. Nintendo only created goated media.",
  },
  {
    id: "mugiwara",
    image: "/assets/textures/sky/mugiwara.png",
    line: "Kathir watches way too much anime. Visit anime.kathirm.com.",
  },
  {
    id: "patriots",
    image: "/assets/textures/sky/patriots.png",
    line: "We are going to the superbowl baby.",
  },
  {
    id: "drake-maye",
    image: "/assets/textures/sky/drake_maye.png",
    line: "All hail glorious king Drake Maye",
  },
];
