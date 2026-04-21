/* Change this file to get your personal Portfolio */

// To change portfolio colors globally go to the  _globalColor.scss file

import emoji from "react-easy-emoji";
import splashAnimation from "./assets/lottie/splashAnimation"; // Rename to your file name for custom animation
import claudeSvg from "./assets/images/claude.svg";

// Splash Screen

const splashScreen = {
  enabled: true, // set false to disable splash screen
  animation: splashAnimation,
  duration: 2000 // Set animation duration as per your animation
};

// Summary And Greeting Section

const illustration = {
  animated: true // Set to false to use static SVG
};

const greeting = {
  username: "Dandi Diputra",
  title: "Hi all, I'm Dandi",
  subTitle: emoji("A passionate Software Engineer 🚀 having an experience of working with Embedded Systems, Real-Time Operating Systems, Telecommunications Core Systems, Financial Technology and Software Engineering Management. Good working knowledge in Go, Java, C/C++, Python and Software Architecture/System Design."),
  resumeLink:
    "https://docs.google.com/document/d/1-Hjjd2DLuQ7uuzL_fi6EorlACtuhohUDttwdKOmm0uU/edit?usp=sharing", // Set to empty to hide the button
  displayGreeting: true // Set false to hide this section, defaults to true
};

// Social Media Links

const socialMediaLinks = {
  //   /* Your Social Media Link */
  github: "https://github.com/dydanz",
  linkedin: "https://www.linkedin.com/in/dandi-diputra/gi",
  youtube: "hidden",
  gmail: "hidden",
  facebook: "hidden",
  instagram: "hidden",
  hackerrank: "https://www.hackerrank.com/dandidiputra",
  // Instagram, Twitter and Kaggle are also supported in the links!
  // To customize icons and social links, tweak src/components/SocialMedia
  display: true // Set true to display this section, defaults to false
};

// Skills Section

const skillsSection = {
  title: "What I do",
  subTitle: "Engineering Leader | Build Scalable Systems | Software Architect | Mentor",
  skills: [
    emoji("⚡ Building scalable systems"),
    emoji("⚡ Growing high-performing engineering teams"),
    emoji("⚡ Contributing to organisational growth and strategy"),
    emoji("⚡ Lifelong learner and mentor"),
  ],

  /* Make Sure to include correct Font Awesome Classname to view your icon
https://fontawesome.com/icons?d=gallery 
https://iconify.design/
*/

  softwareSkills: [
    {
      skillName: "Go",
      classname: "logos:go"
    },
    {
      skillName: "Python",
      classname: "logos:python"
    },
    {
      skillName: "Java",
      classname: "logos:java"
    },
    {
      skillName: "C",
      classname: "logos:c"
    },
    {
      skillName: "C++",
      classname: "logos:c-plusplus"
    },
    {
      skillName: "Embedded C",
      classname: "devicon:embeddedc"
    },
    {
      skillName: "Linux",
      classname: "logos:linux-tux"
    },
    {
      skillName: "Git",
      classname: "logos:git-icon"
    },
    {
      skillName: "Claude Code",
      imageSrc: claudeSvg
    },
    {
      skillName: "AWS",
      classname: "logos:aws"
    },
    {
      skillName: "Apache Kafka",
      classname: "logos:kafka"
    },
    {
      skillName: "Kubernetes",
      classname: "logos:kubernetes"
    },
    {
      skillName: "Google Cloud",
      classname: "logos:google-cloud"
    },
    {
      skillName: "Terraform",
      classname: "logos:terraform-icon"
    },
    {
      skillName: "PostgreSQL",
      classname: "logos:postgresql"
    },
    {
      skillName: "Redis",
      classname: "logos:redis"
    },
    {
      skillName: "RabbitMQ",
      classname: "logos:rabbitmq"
    },
    {
      skillName: "Docker",
      classname: "logos:docker-icon"
    }
  ],
  display: true // Set false to hide this section, defaults to true
};

// Education Section

const educationInfo = {
  display: true, // Set false to hide this section, defaults to true
  schools: [
    {
      schoolName: "Universitas Indonesia",
      logo: require("./assets/images/makaraui.png"), 
      subHeader: "Bachelor of Computer Science",
      duration: "August 2018 - June 2020",
      desc: "Took courses about Software Engineering, Operating Systems, Information Technology, Business and Communications ...",
      descBullets: [
        "Studying Computer Science at Fasilkom UI gave me a strong foundation in core computing concepts—algorithms, data structures, systems, and software engineering. The curriculum is rigorous and pushes you to think analytically and solve problems systematically.",
      ],
    }
  ]
};

// Your top 3 proficient stacks/tech experience

const techStack = {
  viewSkillBars: false, //Set it to true to show Proficiency Section
  experience: [
    {
      Stack: "Frontend/Design", //Insert stack or technology you have experience in
      progressPercentage: "90%" //Insert relative proficiency in percentage
    },
    {
      Stack: "Backend",
      progressPercentage: "70%"
    },
    {
      Stack: "Programming",
      progressPercentage: "60%"
    }
  ],
  displayCodersrank: false // Set true to display codersrank badges section need to changes your username in src/containers/skillProgress/skillProgress.js:17:62, defaults to false
};

// Work experience section

const workExperiences = {
  display: true, //Set it to true to show workExperiences Section
  experience: [
    {
      role: "Engineering Manager",
      company: "Electrum",
      companylogo: require("./assets/images/electrum.png"),
      date: "JAN 2026 - Now",
      location: "Jakarta, Indonesia",
      desc:
        "Managing a lean, cross-functional engineering team while remaining deeply hands-on in development. Split time between building production systems, shaping technical architecture, and enabling the team to scale our AI capabilities.",
    },
    {
      role: "Founding Engineer / Head of Engineering",
      company: "OY! Indonesia",
      companylogo: require("./assets/images/oy_logo.jpeg"),
      date: "FEB 2017 - JULY 2024",
      location: "Jakarta, Indonesia",
      desc:
      "As the Founding Engineer and promoted Head of Engineering at OY! Indonesia, I played a pivotal role in building the company's technology from the ground up. I led the development of our core fintech platform, designed scalable systems to handle high transaction volumes, and established best practices for software development. My responsibilities included overseeing the engineering team, collaborating with cross-functional teams to align technical solutions with business goals, and ensuring the delivery of reliable and secure financial services to our customers.",
    },
    {
      role: "Software Engineering",
      company: "Various Companies",
      companylogo: require("./assets/images/stealth-comp.jpeg"),
      date: "AUG 2006 - JAN 2017",
      location: "Indonesia, Singapore",
      desc:
        "Over the course of a decade, I gained extensive experience in software engineering across various companies and industries. I worked on a wide range of projects, from embedded systems and real-time operating systems to telecommunications core systems and financial technology solutions. My roles involved designing and implementing software architectures, developing applications in multiple programming languages, and collaborating with cross-functional teams to deliver high-quality software products.",
      descBullets: [
        "Worked on a real-time operating system for fleet management, optimizing performance and reliability for mission-critical applications.",
        "Designed and implemented a software architecture for a telecommunications core system.",
        "Developed a financial technology application that processed millions of transactions daily.",
      ]
    }
  ]
};

/* Your Open Source Section to View Your Github Pinned Projects
To know how to get github key look at readme.md */

const openSource = {
  showGithubProfile: "true", // Set true or false to show Contact profile using Github, defaults to true
  display: true // Set false to hide this section, defaults to true
};

// Some big projects you have worked on

const bigProjects = {
  title: "Big Projects",
  subtitle: "SOME STARTUPS AND COMPANIES THAT I HELPED TO CREATE THEIR TECH",
  projects: [],
  display: false // Set false to hide this section, defaults to true
};

// Achievement Section
// Include certificates, talks etc

const achievementSection = {
  title: emoji("Achievements And Certifications 🏆 "),
  subtitle:
    "Achievements, Certifications, Award Letters and Some Cool Stuff that I have done !",

  achievementsCards: [],
  display: false // Set false to hide this section, defaults to true
};

// Blogs Section

const blogSection = {
  display: true
};

// Talks Sections

const talkSection = {
  title: "TALKS",
  subtitle: emoji(
    "I LOVE TO SHARE MY LIMITED KNOWLEDGE AND GET A SPEAKER BADGE 😅"
  ),

  talks: [
    {
      title: "Build Actions For Google Assistant",
      subtitle: "Codelab at GDG DevFest Karachi 2019",
      slides_url: "https://bit.ly/saadpasta-slides",
      event_url: "https://www.facebook.com/events/2339906106275053/"
    }
  ],
  display: false // Set false to hide this section, defaults to true
};

// // Podcast Section

const podcastSection = {
  title: emoji("Podcast 🎙️"),
  subtitle: "I LOVE TO TALK ABOUT MYSELF AND TECHNOLOGY",

  // Please Provide with Your Podcast embeded Link
  podcast: [
    "https://anchor.fm/codevcast/embed/episodes/DevStory---Saad-Pasta-from-Karachi--Pakistan-e9givv/a-a15itvo"
  ],
  display: false // Set false to hide this section, defaults to true
};

const contactInfo = {
  title: emoji("Contact Me ☎️"),
  subtitle:
    "Discuss a project or just want to say hi? My Inbox is open for all.",
  number: "+62-0000000000",
  email_address: "hidden"
};

// Twitter Section

const twitterDetails = {
  userName: "twitter", //Replace "twitter" with your twitter username without @
  display: false // Set true to display this section, defaults to false
};

const isHireable = true; // Set false if you are not looking for a job. Also isHireable will be display as Open for opportunities: Yes/No in the GitHub footer

export {
  illustration,
  greeting,
  socialMediaLinks,
  splashScreen,
  skillsSection,
  educationInfo,
  techStack,
  workExperiences,
  openSource,
  bigProjects,
  achievementSection,
  blogSection,
  talkSection,
  podcastSection,
  contactInfo,
  twitterDetails,
  isHireable
};
